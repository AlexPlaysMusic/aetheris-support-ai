import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { issueSignedToken, presignUrl, put } from '@vercel/blob';
import { checkRateLimit } from './rate-limit';

/**
 * Aetheris developer API keys: opaque `aeth_sk_live_…` bearer tokens stored
 * only as SHA-256 digests plus metadata. The plaintext is shown once.
 *
 * Storage backends, tried in order (first configured wins, cached per process):
 *   1. blob    — Vercel Blob (present on the production project; durable)
 *   2. file    — `<data dir>/record|owner/*.json` (self-hosted deploys)
 *   3. memory  — process-local (last resort; records reset on cold start,
 *                but keys themselves still authenticate because verification
 *                is a digest lookup against whatever backend is active)
 *
 * Two documents per record: a global record keyed by key digest (used by
 * authentication) and an owner list keyed by hash(ownerId) (used by the
 * dashboard). Usage counters live inside the record and are flushed at most
 * once per minute; pending deltas overlay reads in between.
 */

const KEY_PATTERN = /^aeth_sk_live_[A-Za-z0-9_-]{43}$/;
const KEY_ID_PATTERN = /^[a-f0-9]{64}$/;
const BLOB_RECORD_PREFIX = 'aetheris/keys/record/';
const BLOB_OWNER_PREFIX = 'aetheris/keys/owner/';
const USAGE_FLUSH_MS = 60_000;

export type ApiKeyClaimTier = 'asteroid' | 'pro';

export type ApiKeyUsage = {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  lastUsedAt: string | null;
};

export type ApiKeyRecord = {
  id: string;
  ownerId: string;
  label: string;
  prefix: string;
  createdAt: string;
  revokedAt: string | null;
  /** Membership backing this key when it was issued/refreshed (claim only —
   *  always re-verified against PayPal at use time, never trusted alone). */
  claimTier?: ApiKeyClaimTier | null;
  claimSubscriptionId?: string | null;
  usage?: ApiKeyUsage;
};

export type ListedApiKey = ApiKeyRecord & {
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  lastUsedAt: string | null;
};

type StoreBackend = 'blob' | 'file' | 'memory';

let backend: StoreBackend | null = null;
const memoryDocs = new Map<string, string>();
const usageDeltas = new Map<
  string,
  { requests: number; promptTokens: number; completionTokens: number; lastUsedAt: string | null; flushedAt: number }
>();

/** Test hook: forget the chosen backend and all in-memory state. */
export function resetApiKeyStore(): void {
  backend = null;
  memoryDocs.clear();
  usageDeltas.clear();
}

function dataDir(): string {
  return process.env.AETHERIS_DATA_DIR ?? path.join(process.cwd(), 'data', 'aetheris-keys');
}

async function detectBackend(): Promise<StoreBackend> {
  if (backend) return backend;
  const forced = process.env.AETHERIS_KEY_STORE;
  if (forced === 'blob' || forced === 'file' || forced === 'memory') {
    backend = forced;
    return backend;
  }
  if ((process.env.BLOB_READ_WRITE_TOKEN ?? '') !== '') {
    backend = 'blob';
    return backend;
  }
  try {
    await fs.mkdir(path.join(dataDir(), 'record'), { recursive: true });
    const probe = path.join(dataDir(), '.probe');
    await fs.writeFile(probe, 'ok', 'utf8');
    await fs.unlink(probe);
    backend = 'file';
  } catch {
    backend = 'memory';
  }
  return backend;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

function ownerPath(ownerId: string): string {
  return `${BLOB_OWNER_PREFIX}${hashApiKey(ownerId)}.json`;
}

function recordPath(keyId: string): string {
  return `${BLOB_RECORD_PREFIX}${keyId}.json`;
}

function docFile(kind: 'record' | 'owner', id: string): string {
  const safe = /^[a-f0-9]{16,128}$/.test(id) ? id : hashApiKey(id);
  return path.join(dataDir(), kind, `${safe}.json`);
}

async function readBlobDoc(pathname: string): Promise<string | null> {
  const validUntil = Date.now() + 60_000;
  const signed = await issueSignedToken({ pathname, operations: ['get'], validUntil });
  const { presignedUrl } = await presignUrl(signed, {
    access: 'private',
    operation: 'get',
    pathname,
    validUntil,
    useCache: false
  });
  const res = await fetch(presignedUrl, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API key store read failed (${res.status}).`);
  return res.text();
}

async function writeBlobDoc(pathname: string, body: string): Promise<void> {
  await put(pathname, body, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json'
  });
}

async function readDoc(kind: 'record' | 'owner', id: string): Promise<string | null> {
  const active = await detectBackend();
  if (active === 'blob') {
    return readBlobDoc(kind === 'record' ? recordPath(id) : ownerPath(id));
  }
  if (active === 'file') {
    try {
      return await fs.readFile(docFile(kind, id), 'utf8');
    } catch {
      return null;
    }
  }
  return memoryDocs.get(`${kind}:${id}`) ?? null;
}

async function writeDoc(kind: 'record' | 'owner', id: string, body: string): Promise<void> {
  const active = await detectBackend();
  if (active === 'blob') {
    await writeBlobDoc(kind === 'record' ? recordPath(id) : ownerPath(id), body);
    return;
  }
  if (active === 'file') {
    const target = docFile(kind, id);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body, 'utf8');
    return;
  }
  memoryDocs.set(`${kind}:${id}`, body);
}

function parseUsage(value: unknown): ApiKeyUsage | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const count = (field: unknown): number =>
    typeof field === 'number' && Number.isSafeInteger(field) && field >= 0 ? field : 0;
  return {
    requests: count(raw['requests']),
    promptTokens: count(raw['promptTokens']),
    completionTokens: count(raw['completionTokens']),
    lastUsedAt: typeof raw['lastUsedAt'] === 'string' ? raw['lastUsedAt'] : null
  };
}

function parseRecord(value: unknown): ApiKeyRecord | null {
  // Records arrive as JSON strings from the record documents and as plain
  // objects when read out of an owner list — accept both.
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    typeof (parsed as Record<string, unknown>)['id'] !== 'string' ||
    typeof (parsed as Record<string, unknown>)['ownerId'] !== 'string' ||
    typeof (parsed as Record<string, unknown>)['label'] !== 'string' ||
    typeof (parsed as Record<string, unknown>)['prefix'] !== 'string' ||
    typeof (parsed as Record<string, unknown>)['createdAt'] !== 'string'
  ) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const claimTier =
    record['claimTier'] === 'asteroid' || record['claimTier'] === 'pro'
      ? record['claimTier']
      : null;
  const claimSubscriptionId =
    typeof record['claimSubscriptionId'] === 'string' && record['claimSubscriptionId'] !== ''
      ? record['claimSubscriptionId']
      : null;
  const usage = parseUsage(record['usage']);
  return {
    id: record['id'] as string,
    ownerId: record['ownerId'] as string,
    label: record['label'] as string,
    prefix: record['prefix'] as string,
    createdAt: record['createdAt'] as string,
    revokedAt: typeof record['revokedAt'] === 'string' ? record['revokedAt'] : null,
    claimTier,
    claimSubscriptionId,
    ...(usage ? { usage } : {})
  };
}

function parseOwnerList(value: unknown): ApiKeyRecord[] | null {
  if (typeof value !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const doc = parsed as Record<string, unknown>;
  if (!Array.isArray(doc['keys'])) return null;
  return doc['keys'].map(parseRecord).filter((r): r is ApiKeyRecord => r !== null);
}

async function readRecordDoc(keyId: string): Promise<ApiKeyRecord | null> {
  if (!KEY_ID_PATTERN.test(keyId)) return null;
  return parseRecord(await readDoc('record', keyId));
}

async function writeRecordDoc(record: ApiKeyRecord): Promise<void> {
  await writeDoc('record', record.id, JSON.stringify(record));
}

async function readOwnerDoc(ownerId: string): Promise<ApiKeyRecord[]> {
  const raw = await readDoc('owner', hashApiKey(ownerId));
  const parsed = parseOwnerList(raw);
  return parsed ?? [];
}

async function writeOwnerDoc(ownerId: string, records: ApiKeyRecord[]): Promise<void> {
  await writeDoc('owner', hashApiKey(ownerId), JSON.stringify({ keys: records }));
}

function pendingDelta(keyId: string) {
  let delta = usageDeltas.get(keyId);
  if (!delta) {
    delta = { requests: 0, promptTokens: 0, completionTokens: 0, lastUsedAt: null, flushedAt: 0 };
    usageDeltas.set(keyId, delta);
  }
  return delta;
}

/** Merge pending usage deltas into the stored record (throttled to 1/min). */
async function flushUsage(keyId: string): Promise<void> {
  const delta = usageDeltas.get(keyId);
  if (!delta) return;
  const now = Date.now();
  if (delta.requests === 0 && delta.promptTokens === 0 && delta.completionTokens === 0) return;
  if (now - delta.flushedAt < USAGE_FLUSH_MS) return;
  const record = await readRecordDoc(keyId);
  if (!record) {
    usageDeltas.delete(keyId);
    return;
  }
  const stored = record.usage ?? {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    lastUsedAt: null
  };
  record.usage = {
    requests: stored.requests + delta.requests,
    promptTokens: stored.promptTokens + delta.promptTokens,
    completionTokens: stored.completionTokens + delta.completionTokens,
    lastUsedAt: delta.lastUsedAt ?? stored.lastUsedAt
  };
  await writeRecordDoc(record);
  const owner = await readOwnerDoc(record.ownerId);
  const idx = owner.findIndex((item) => item.id === record.id);
  if (idx >= 0) owner[idx] = record;
  else owner.push(record);
  await writeOwnerDoc(record.ownerId, owner);
  delta.requests = 0;
  delta.promptTokens = 0;
  delta.completionTokens = 0;
  delta.flushedAt = now;
}

function withUsageOverlay(record: ApiKeyRecord): ListedApiKey {
  const delta = usageDeltas.get(record.id);
  const stored = record.usage ?? {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    lastUsedAt: null
  };
  const lastUsedAt = delta?.lastUsedAt ?? stored.lastUsedAt;
  return {
    ...record,
    requestCount: stored.requests + (delta?.requests ?? 0),
    promptTokens: stored.promptTokens + (delta?.promptTokens ?? 0),
    completionTokens: stored.completionTokens + (delta?.completionTokens ?? 0),
    lastUsedAt
  };
}

export async function createApiKey(
  ownerId: string,
  label: string,
  claim?: { tier: ApiKeyClaimTier; subscriptionId?: string | null } | null
): Promise<{ key: string; record: ApiKeyRecord }> {
  const key = `aeth_sk_live_${randomBytes(32).toString('base64url')}`;
  const id = hashApiKey(key);
  if (await readRecordDoc(id)) throw new Error('Could not reserve a unique API key.');
  const record: ApiKeyRecord = {
    id,
    ownerId,
    label,
    prefix: key.slice(0, 20),
    createdAt: new Date().toISOString(),
    revokedAt: null,
    claimTier: null,
    claimSubscriptionId: null
  };
  if (claim && (claim.tier === 'asteroid' || claim.tier === 'pro')) {
    record.claimTier = claim.tier;
    record.claimSubscriptionId =
      typeof claim.subscriptionId === 'string' && claim.subscriptionId !== ''
        ? claim.subscriptionId
        : null;
  }
  await writeRecordDoc(record);
  const owner = await readOwnerDoc(ownerId);
  owner.push(record);
  await writeOwnerDoc(ownerId, owner);
  return { key, record };
}

export async function listApiKeys(ownerId: string): Promise<ListedApiKey[]> {
  const owner = await readOwnerDoc(ownerId);
  // Flush anything pending for this owner so the dashboard shows fresh counts.
  for (const record of owner) await flushUsage(record.id);
  const fresh = owner.length > 0 ? await readOwnerDoc(ownerId) : owner;
  return fresh.map(withUsageOverlay).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function revokeApiKey(ownerId: string, id: string): Promise<boolean> {
  if (!KEY_ID_PATTERN.test(id)) return false;
  const owner = await readOwnerDoc(ownerId);
  const record = owner.find((item) => item.id === id);
  if (!record || record.revokedAt) return false;
  record.revokedAt = new Date().toISOString();
  await writeRecordDoc(record);
  await writeOwnerDoc(
    ownerId,
    owner.map((item) => (item.id === id ? record : item))
  );
  usageDeltas.delete(id);
  return true;
}

/**
 * Refresh membership claims on an owner's active keys. Only upgrades (or
 * re-points to a newer subscription) — claims are never cleared here; a
 * cancelled subscription fails the live PayPal check at use time instead.
 */
export async function refreshApiKeyClaims(
  ownerId: string,
  claim: { tier: ApiKeyClaimTier; subscriptionId: string | null } | null
): Promise<number> {
  if (!claim || (claim.tier !== 'asteroid' && claim.tier !== 'pro')) return 0;
  const owner = await readOwnerDoc(ownerId);
  let changed = 0;
  for (const record of owner) {
    if (record.revokedAt) continue;
    if (record.claimTier === claim.tier && record.claimSubscriptionId === claim.subscriptionId) {
      continue;
    }
    record.claimTier = claim.tier;
    record.claimSubscriptionId = claim.subscriptionId;
    changed += 1;
  }
  if (changed > 0) {
    await writeOwnerDoc(ownerId, owner);
    for (const record of owner) {
      if (!record.revokedAt && record.claimTier === claim.tier) await writeRecordDoc(record);
    }
  }
  return changed;
}

export async function authenticateApiKey(
  authorization: string | null
): Promise<ApiKeyRecord | null> {
  if (!authorization?.startsWith('Bearer ')) return null;
  const key = authorization.slice(7).trim();
  if (!KEY_PATTERN.test(key)) return null;
  const record = await readRecordDoc(hashApiKey(key));
  if (!record || record.revokedAt) return null;
  return record;
}

export async function checkApiKeyRateLimit(id: string, limit: number): Promise<boolean> {
  return checkRateLimit(`aetheris-api-key:${id}`, limit, 60_000).ok;
}

export async function recordApiKeyUsage(id: string): Promise<void> {
  const delta = pendingDelta(id);
  delta.requests += 1;
  delta.lastUsedAt = new Date().toISOString();
  await flushUsage(id);
}

export async function recordApiKeyTokens(
  id: string,
  promptTokens: number,
  completionTokens: number
): Promise<void> {
  const delta = pendingDelta(id);
  if (Number.isSafeInteger(promptTokens) && promptTokens > 0) {
    delta.promptTokens += promptTokens;
  }
  if (Number.isSafeInteger(completionTokens) && completionTokens > 0) {
    delta.completionTokens += completionTokens;
  }
  await flushUsage(id);
}
