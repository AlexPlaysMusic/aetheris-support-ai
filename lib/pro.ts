import { getSharedRedis } from './credit-server';
import { getSubscription, subscriptionIsPaying } from './paypal';

/**
 * Pro entitlements: who paid, verified against PayPal, cached in Redis.
 * - `aetheris:pro:<userId>` = { active, subscriptionId, checkedAt }
 * - Revalidated against PayPal at most once per 24h (catches cancels).
 * - Without Redis (local dev), an in-memory map applies per process.
 * - Guests can never be Pro (no account to attach billing to).
 */

export type PlanTierStatus = 'basic' | 'asteroid' | 'pro';

export type ProStatus = {
  pro: boolean;
  tier: PlanTierStatus;
  subscriptionId: string | null;
  checkedAt: number | null;
};

type StoredPro = {
  tier: PlanTierStatus;
  subscriptionId: string;
  checkedAt: number;
  /** legacy shape (pre-tier): active boolean only */
  active?: boolean;
};

const REVALIDATE_MS = 24 * 3600 * 1000;
const PRO_KEY_PREFIX = 'aetheris:pro:';

const memoryPro = new Map<string, StoredPro>();

/** Test hook: clear the in-memory fallback. */
export function resetProMemory(): void {
  memoryPro.clear();
}

function normalizeStored(parsed: Partial<StoredPro>): StoredPro | null {
  const tier: PlanTierStatus =
    parsed.tier === 'pro' || parsed.tier === 'asteroid'
      ? parsed.tier
      : parsed.active === true
        ? 'pro' // legacy pre-tier records were Pro memberships
        : 'basic';
  if (tier === 'basic') return null;
  return {
    tier,
    subscriptionId:
      typeof parsed.subscriptionId === 'string' ? parsed.subscriptionId : '',
    checkedAt: typeof parsed.checkedAt === 'number' ? parsed.checkedAt : 0
  };
}

async function readPro(userId: string): Promise<StoredPro | null> {
  const redis = getSharedRedis();
  if (redis) {
    try {
      const raw = await redis.get<string>(PRO_KEY_PREFIX + userId);
      if (!raw) return null;
      return normalizeStored(JSON.parse(raw) as Partial<StoredPro>);
    } catch {
      return null;
    }
  }
  const mem = memoryPro.get(userId) ?? null;
  return mem ? normalizeStored(mem) : null;
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

/** Drop an account back to Basic (cancelled / expired upstream). */
export async function clearMembership(userId: string): Promise<void> {
  const redis = getSharedRedis();
  if (redis) {
    try {
      await redis.del(PRO_KEY_PREFIX + userId);
    } catch {
      /* ignore */
    }
  }
  memoryPro.delete(userId);
}

/** Mark an account paid after a verified subscription approval. */
export async function setTierActive(
  userId: string,
  tier: Exclude<PlanTierStatus, 'basic'>,
  subscriptionId: string
): Promise<void> {
  await writePro(userId, {
    tier,
    subscriptionId,
    checkedAt: Date.now()
  });
}

/** Backwards-compatible alias (Pro tier). */
export async function setProActive(
  userId: string,
  subscriptionId: string
): Promise<void> {
  await setTierActive(userId, 'pro', subscriptionId);
}

async function revalidate(
  userId: string,
  stored: StoredPro
): Promise<ProStatus> {
  if (Date.now() - stored.checkedAt < REVALIDATE_MS) {
    return {
      pro: stored.tier === 'pro',
      tier: stored.tier,
      subscriptionId: stored.subscriptionId || null,
      checkedAt: stored.checkedAt
    };
  }
  if (stored.subscriptionId === '') {
    return { pro: false, tier: 'basic', subscriptionId: null, checkedAt: stored.checkedAt };
  }
  const live = await getSubscription(stored.subscriptionId);
  const paying = live.ok && subscriptionIsPaying(live.status);
  const tier: PlanTierStatus = paying ? stored.tier : 'basic';
  const next: StoredPro = {
    tier,
    subscriptionId: stored.subscriptionId,
    checkedAt: Date.now()
  };
  await writePro(userId, next);
  return {
    pro: tier === 'pro',
    tier,
    subscriptionId: next.subscriptionId,
    checkedAt: next.checkedAt
  };
}

export async function getProStatus(userId: string | null): Promise<ProStatus> {
  if (!userId) {
    return { pro: false, tier: 'basic', subscriptionId: null, checkedAt: null };
  }
  const stored = await readPro(userId);
  if (!stored) {
    return { pro: false, tier: 'basic', subscriptionId: null, checkedAt: null };
  }
  return revalidate(userId, stored);
}

/** Full membership tier (basic for guests and unpaid accounts). */
export async function getTier(userId: string | null): Promise<PlanTierStatus> {
  return (await getProStatus(userId)).tier;
}
