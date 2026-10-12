import { Redis } from '@upstash/redis';
import {
  CREDIT_DAILY_GUEST,
  CREDIT_DAILY_USER
} from './credits';

/**
 * Strict server-side credit metering backed by Upstash Redis (via the
 * Vercel Marketplace Redis integration, which injects UPSTASH_REDIS_REST_URL
 * and UPSTASH_REDIS_REST_TOKEN).
 *
 * - Signed-in users are keyed by their verified NextAuth id (unforgeable).
 * - Guests are keyed by IP (x-forwarded-for). Shared NATs share a bucket —
 *   acceptable for abuse control, not per-person accounting.
 * - Fixed UTC-day buckets, auto-expire after 3 days.
 * - Fails OPEN (allows the request) if Redis is unreachable, so a store
 *   outage never bricks chat. Lapses are logged, not fatal.
 * - When Redis isn't configured at all (e.g. local dev), metering is
 *   skipped and the client-side honor system applies.
 */

let redis: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL ?? '';
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? '';
  if (url === '' || token === '') {
    redis = null;
    return redis;
  }
  redis = new Redis({ url, token });
  return redis;
}

export function strictMeteringEnabled(): boolean {
  return getRedis() !== null;
}

function utcDayKey(date: Date = new Date()): string {
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${m}-${d}`;
}

export type StrictIdentity =
  | { kind: 'user'; id: string; daily: number }
  | { kind: 'guest'; id: string; daily: number };

export function strictIdentityFor(
  userId: string | null,
  ip: string | null
): StrictIdentity {
  if (userId) {
    return { kind: 'user', id: userId, daily: CREDIT_DAILY_USER };
  }
  return { kind: 'guest', id: ip && ip !== '' ? ip : 'unknown', daily: CREDIT_DAILY_GUEST };
}

function balanceKey(identity: StrictIdentity): string {
  const safeId = identity.id.replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 120);
  return `aetheris:credits:${utcDayKey()}:${identity.kind}:${safeId}`;
}

/** Remaining credits today, or null when metering is off/unreachable. */
export async function strictBalance(
  identity: StrictIdentity
): Promise<number | null> {
  const client = getRedis();
  if (!client) return null;
  try {
    const used = await client.get<number>(balanceKey(identity));
    return Math.max(0, identity.daily - (typeof used === 'number' ? used : 0));
  } catch (err) {
    console.warn('[aetheris/credits] balance read failed:', err);
    return null;
  }
}

/**
 * Spend credits. Returns the new balance, or null when metering is
 * off/unreachable (caller should allow the request).
 * Throws nothing — overdraft is reported via ok:false.
 */
export async function strictSpend(
  identity: StrictIdentity,
  amount: number
): Promise<{ ok: boolean; remaining: number | null }> {
  const client = getRedis();
  if (!client) return { ok: true, remaining: null };
  const key = balanceKey(identity);
  try {
    const used = await client.incrby(key, amount);
    if (used === amount) {
      // First write for this bucket — give it a TTL so old keys vanish.
      await client.expire(key, 3 * 24 * 3600);
    }
    if (used > identity.daily) {
      await client.decrby(key, amount);
      return { ok: false, remaining: 0 };
    }
    return { ok: true, remaining: identity.daily - used };
  } catch (err) {
    console.warn('[aetheris/credits] spend failed (allowing request):', err);
    return { ok: true, remaining: null };
  }
}

/** Refund a spend that never produced a response (thrown before streaming). */
export async function strictRefund(
  identity: StrictIdentity,
  amount: number
): Promise<void> {
  const client = getRedis();
  if (!client || amount <= 0) return;
  try {
    await client.decrby(balanceKey(identity), amount);
  } catch (err) {
    console.warn('[aetheris/credits] refund failed:', err);
  }
}
