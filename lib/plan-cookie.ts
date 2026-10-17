import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed plan cookies: tamper-proof membership proof that needs no
 * database. The value is HMAC-SHA256(profile, NEXTAUTH_SECRET) so only
 * the server can mint it, and the userId is bound inside the payload so
 * a stolen cookie can't be replayed under a different account.
 *
 * Lifecycle: issued on subscribe/restore (7-day TTL) -> trusted as-is
 * for 24h -> revalidated live against PayPal on next touch -> renewed
 * or cleared.
 */

export const PLAN_COOKIE_NAME = 'aetheris_plan';
export const PLAN_COOKIE_TTL_MS = 7 * 24 * 3600 * 1000;
export const PLAN_COOKIE_REVALIDATE_AFTER_MS = 24 * 3600 * 1000;

export type PlanCookieTier = 'asteroid' | 'pro';

interface PlanCookiePayload {
  u: string;
  t: PlanCookieTier;
  s: string;
  iat: number;
}

function getSecret(): string {
  return process.env.NEXTAUTH_SECRET ?? '';
}

function b64encode(raw: string): string {
  return Buffer.from(raw, 'utf8').toString('base64url');
}

function b64decode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

/** Mint a signed cookie value. Returns null when no signing secret exists. */
export function signPlanCookie(
  userId: string,
  tier: PlanCookieTier,
  subscriptionId: string,
  now: number = Date.now()
): string | null {
  const secret = getSecret();
  if (secret === '' || userId === '' || subscriptionId === '') return null;
  if (tier !== 'asteroid' && tier !== 'pro') return null;
  const payload = b64encode(
    JSON.stringify({ u: userId, t: tier, s: subscriptionId, iat: now })
  );
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return `v1.${payload}.${sig}`;
}

export type VerifiedPlanCookie = {
  tier: PlanCookieTier;
  subscriptionId: string;
  issuedAt: number;
  /** true once the cookie is older than the revalidation window (still authentic). */
  stale: boolean;
};

/**
 * Verify a cookie value: correct signature, matching user, known shape.
 * Returns null for anything forged, foreign, or malformed.
 */
export function verifyPlanCookie(
  value: string | undefined | null,
  expectedUserId: string,
  now: number = Date.now()
): VerifiedPlanCookie | null {
  if (!value || !expectedUserId) return null;
  const secret = getSecret();
  if (secret === '') return null;
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const [, payload, sig] = parts as [string, string, string];
  let expected: string;
  try {
    expected = createHmac('sha256', secret).update(payload).digest('hex');
  } catch {
    return null;
  }
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let rec: Partial<PlanCookiePayload>;
  try {
    rec = JSON.parse(b64decode(payload)) as Partial<PlanCookiePayload>;
  } catch {
    return null;
  }
  if (rec.u !== expectedUserId) return null;
  if (rec.t !== 'asteroid' && rec.t !== 'pro') return null;
  if (typeof rec.s !== 'string' || rec.s === '') return null;
  if (typeof rec.iat !== 'number' || !Number.isFinite(rec.iat)) return null;
  // Past TTL is dead even if the signature is genuine.
  if (now - rec.iat > PLAN_COOKIE_TTL_MS) return null;
  return {
    tier: rec.t,
    subscriptionId: rec.s,
    issuedAt: rec.iat,
    stale: now - rec.iat > PLAN_COOKIE_REVALIDATE_AFTER_MS
  };
}

export function serializePlanCookie(value: string, maxAgeSeconds?: number): string {
  const maxAge =
    typeof maxAgeSeconds === 'number'
      ? maxAgeSeconds
      : Math.floor(PLAN_COOKIE_TTL_MS / 1000);
  const parts = [
    `${PLAN_COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

export function clearPlanCookieHeader(): string {
  const parts = [
    `${PLAN_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

/** Pull one cookie value out of a raw Cookie header. Returns null if absent. */
export function getCookieValue(
  cookieHeader: string | null,
  name: string
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return part.slice(idx + 1).trim() || null;
      }
    }
  }
  return null;
}
