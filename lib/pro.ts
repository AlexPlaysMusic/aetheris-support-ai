import { getSharedRedis } from './credit-server';
import { getSubscription, subscriptionIsPaying } from './paypal';

/**
 * Pro entitlements: who paid, verified against PayPal, cached in Redis.
 * - `aetheris:pro:<userId>` = { active, subscriptionId, checkedAt }
 * - Revalidated against PayPal at most once per 24h (catches cancels).
 * - Without Redis (local dev), an in-memory map applies per process.
 * - Guests can never be Pro (no account to attach billing to).
 */

export type ProStatus = {
  pro: boolean;
  subscriptionId: string | null;
  checkedAt: number | null;
};

type StoredPro = {
  active: boolean;
  subscriptionId: string;
  checkedAt: number;
};

const REVALIDATE_MS = 24 * 3600 * 1000;
const PRO_KEY_PREFIX = 'aetheris:pro:';

const memoryPro = new Map<string, StoredPro>();

/** Test hook: clear the in-memory fallback. */
export function resetProMemory(): void {
  memoryPro.clear();
}

async function readPro(userId: string): Promise<StoredPro | null> {
  const redis = getSharedRedis();
  if (redis) {
    try {
      const raw = await redis.get<string>(PRO_KEY_PREFIX + userId);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<StoredPro>;
      if (typeof parsed.active !== 'boolean') return null;
      return {
        active: parsed.active,
        subscriptionId:
          typeof parsed.subscriptionId === 'string' ? parsed.subscriptionId : '',
        checkedAt: typeof parsed.checkedAt === 'number' ? parsed.checkedAt : 0
      };
    } catch {
      return null;
    }
  }
  return memoryPro.get(userId) ?? null;
}

async function writePro(userId: string, value: StoredPro): Promise<void> {
  const redis = getSharedRedis();
  if (redis) {
    try {
      await redis.set(PRO_KEY_PREFIX + userId, JSON.stringify(value));
      return;
    } catch {
      /* fall through to memory */
    }
  }
  memoryPro.set(userId, value);
}

/** Mark an account Pro after a verified subscription approval. */
export async function setProActive(
  userId: string,
  subscriptionId: string
): Promise<void> {
  await writePro(userId, {
    active: true,
    subscriptionId,
    checkedAt: Date.now()
  });
}

async function revalidate(
  userId: string,
  stored: StoredPro
): Promise<ProStatus> {
  if (Date.now() - stored.checkedAt < REVALIDATE_MS) {
    return {
      pro: stored.active,
      subscriptionId: stored.subscriptionId || null,
      checkedAt: stored.checkedAt
    };
  }
  if (!stored.active || stored.subscriptionId === '') {
    return { pro: false, subscriptionId: null, checkedAt: stored.checkedAt };
  }
  const live = await getSubscription(stored.subscriptionId);
  const paying = live.ok && subscriptionIsPaying(live.status);
  const next: StoredPro = {
    active: paying,
    subscriptionId: stored.subscriptionId,
    checkedAt: Date.now()
  };
  await writePro(userId, next);
  return { pro: paying, subscriptionId: next.subscriptionId, checkedAt: next.checkedAt };
}

export async function getProStatus(userId: string | null): Promise<ProStatus> {
  if (!userId) return { pro: false, subscriptionId: null, checkedAt: null };
  const stored = await readPro(userId);
  if (!stored) return { pro: false, subscriptionId: null, checkedAt: null };
  return revalidate(userId, stored);
}
