import { createHash, randomBytes } from 'node:crypto';
import { getSharedRedis } from './credit-server';

const KEY_PREFIX = 'aetheris:api:key:';
const OWNER_PREFIX = 'aetheris:api:owner:';
const USAGE_PREFIX = 'aetheris:api:usage:';
const RATE_PREFIX = 'aetheris:api:rate:';
const KEY_PATTERN = /^aeth_sk_live_[A-Za-z0-9_-]{43}$/;
const KEY_ID_PATTERN = /^[a-f0-9]{64}$/;

export type ApiKeyRecord = {
  id: string;
  ownerId: string;
  label: string;
  prefix: string;
  createdAt: string;
  revokedAt: string | null;
};

function redisOrThrow() {
  const redis = getSharedRedis();
  if (!redis) throw new Error('API key storage is not configured.');
  return redis;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

function keyRecordKey(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

function ownerIndexKey(ownerId: string): string {
  return `${OWNER_PREFIX}${hashApiKey(ownerId)}`;
}

function usageKey(id: string): string {
  return `${USAGE_PREFIX}${id}`;
}

function rateKey(id: string, window: number): string {
  return `${RATE_PREFIX}${id}:${window}`;
}

function parseRecord(value: unknown): ApiKeyRecord | null {
  if (typeof value !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
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
  return {
    id: record['id'] as string,
    ownerId: record['ownerId'] as string,
    label: record['label'] as string,
    prefix: record['prefix'] as string,
    createdAt: record['createdAt'] as string,
    revokedAt: typeof record['revokedAt'] === 'string' ? record['revokedAt'] : null
  };
}

export async function createApiKey(
  ownerId: string,
  label: string
): Promise<{ key: string; record: ApiKeyRecord }> {
  const redis = redisOrThrow();
  const key = `aeth_sk_live_${randomBytes(32).toString('base64url')}`;
  const id = hashApiKey(key);
  const record: ApiKeyRecord = {
    id,
    ownerId,
    label,
    prefix: key.slice(0, 20),
    createdAt: new Date().toISOString(),
    revokedAt: null
  };
  const saved = await redis.set(keyRecordKey(id), JSON.stringify(record), { nx: true });
  if (saved !== 'OK') throw new Error('Could not reserve a unique API key.');
  await redis.sadd(ownerIndexKey(ownerId), id);
  return { key, record };
}

export async function listApiKeys(ownerId: string): Promise<
  Array<
    ApiKeyRecord & {
      requestCount: number;
      promptTokens: number;
      completionTokens: number;
      lastUsedAt: string | null;
    }
  >
> {
  const redis = redisOrThrow();
  const ids = await redis.smembers<string[]>(ownerIndexKey(ownerId));
  const records = await Promise.all(
    ids.map(async (id) => {
      if (!KEY_ID_PATTERN.test(id)) return null;
      const record = parseRecord(await redis.get(keyRecordKey(id)));
      if (!record || record.ownerId !== ownerId) return null;
      const usage = await redis.hgetall<Record<string, string | number>>(
        usageKey(id)
      );
      const count = Number(usage?.['requests'] ?? 0);
      const promptTokens = Number(usage?.['promptTokens'] ?? 0);
      const completionTokens = Number(usage?.['completionTokens'] ?? 0);
      return {
        ...record,
        requestCount: Number.isFinite(count) ? count : 0,
        promptTokens: Number.isFinite(promptTokens) ? promptTokens : 0,
        completionTokens: Number.isFinite(completionTokens) ? completionTokens : 0,
        lastUsedAt:
          typeof usage?.['lastUsedAt'] === 'string' ? usage['lastUsedAt'] : null
      };
    })
  );
  return records
    .filter(
      (
        record
      ): record is ApiKeyRecord & {
        requestCount: number;
        promptTokens: number;
        completionTokens: number;
        lastUsedAt: string | null;
      } => record !== null
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function revokeApiKey(
  ownerId: string,
  id: string
): Promise<boolean> {
  if (!KEY_ID_PATTERN.test(id)) return false;
  const redis = redisOrThrow();
  const record = parseRecord(await redis.get(keyRecordKey(id)));
  if (!record || record.ownerId !== ownerId || record.revokedAt) return false;
  record.revokedAt = new Date().toISOString();
  await redis.set(keyRecordKey(id), JSON.stringify(record));
  return true;
}

export async function authenticateApiKey(
  authorization: string | null
): Promise<ApiKeyRecord | null> {
  if (!authorization?.startsWith('Bearer ')) return null;
  const key = authorization.slice(7).trim();
  if (!KEY_PATTERN.test(key)) return null;
  const id = hashApiKey(key);
  const redis = getSharedRedis();
  if (!redis) throw new Error('API key storage is not configured.');
  const record = parseRecord(await redis.get(keyRecordKey(id)));
  if (!record || record.id !== id || record.revokedAt) return null;
  return record;
}

export async function checkApiKeyRateLimit(
  id: string,
  limit: number
): Promise<boolean> {
  const redis = redisOrThrow();
  const window = Math.floor(Date.now() / 60_000);
  const key = rateKey(id, window);
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 120);
  return count <= limit;
}

export async function recordApiKeyUsage(id: string): Promise<void> {
  const redis = redisOrThrow();
  const key = usageKey(id);
  await redis.hincrby(key, 'requests', 1);
  await redis.hset(key, { lastUsedAt: new Date().toISOString() });
}

export async function recordApiKeyTokens(
  id: string,
  promptTokens: number,
  completionTokens: number
): Promise<void> {
  const redis = redisOrThrow();
  const key = usageKey(id);
  if (Number.isSafeInteger(promptTokens) && promptTokens > 0) {
    await redis.hincrby(key, 'promptTokens', promptTokens);
  }
  if (Number.isSafeInteger(completionTokens) && completionTokens > 0) {
    await redis.hincrby(key, 'completionTokens', completionTokens);
  }
}
