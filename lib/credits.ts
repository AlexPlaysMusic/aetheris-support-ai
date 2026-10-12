/**
 * Daily credit metering (client-side).
 *
 * Honest note: this is honor-system metering — it stops casual overuse and
 * communicates the plan limits, but a determined user can clear site data
 * to reset it. Strict enforcement needs a server-side store (e.g. Vercel KV
 * keyed by user id); this module is shaped so that store can slot in later.
 *
 * Pricing:
 * - Basic text message: 1 credit
 * - Each attached photo: +2 credits
 * - Each attached file (PDF/TXT/JSON/CSV): +1 credit
 * - Pro message: 5 credits (deeper model; Pro is locked for now)
 *
 * Daily allowances (reset at local midnight):
 * - Guest: 20/day — enough to try everything
 * - Signed-in: 100/day
 * - Pro: 1,000/day
 */

export const CREDIT_DAILY_GUEST = 20;
export const CREDIT_DAILY_USER = 100;
export const CREDIT_DAILY_PRO = 1000;

export const CREDIT_COST_TEXT = 1;
export const CREDIT_COST_IMAGE = 2;
export const CREDIT_COST_FILE = 1;
export const CREDIT_COST_PRO_MESSAGE = 5;

export type CreditIdentity = {
  /** localStorage key for this identity's balance. */
  key: string;
  /** credits per day. */
  daily: number;
};

export function creditIdentity(userId: string | null): CreditIdentity {
  return userId
    ? { key: `aetheris-credits:${userId}`, daily: CREDIT_DAILY_USER }
    : { key: `aetheris-credits:guest`, daily: CREDIT_DAILY_GUEST };
}

export function todayKey(date: Date = new Date()): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

function loadUsed(storageKey: string): number {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { day?: unknown; used?: unknown };
    if (parsed.day !== todayKey()) return 0;
    return typeof parsed.used === 'number' && parsed.used > 0
      ? Math.floor(parsed.used)
      : 0;
  } catch {
    return 0;
  }
}

function saveUsed(storageKey: string, used: number): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ day: todayKey(), used }));
  } catch {
    /* storage full / private mode — ignore */
  }
}

export function remainingCredits(identity: CreditIdentity): number {
  return Math.max(0, identity.daily - loadUsed(identity.key));
}

export function messageCost(opts: {
  pro: boolean;
  images: number;
  files: number;
}): number {
  return (
    (opts.pro ? CREDIT_COST_PRO_MESSAGE : CREDIT_COST_TEXT) +
    opts.images * CREDIT_COST_IMAGE +
    opts.files * CREDIT_COST_FILE
  );
}

/**
 * Try to spend credits. Returns the remaining balance, or null when the
 * identity can't afford the amount.
 */
export function spendCredits(
  identity: CreditIdentity,
  amount: number
): number | null {
  const remaining = remainingCredits(identity);
  if (remaining < amount) return null;
  const next = remaining - amount;
  saveUsed(identity.key, identity.daily - next);
  return next;
}

/** Refund a previous spend (e.g. the request failed). Returns new balance. */
export function refundCredits(
  identity: CreditIdentity,
  amount: number
): number {
  const used = Math.max(0, loadUsed(identity.key) - amount);
  saveUsed(identity.key, used);
  return Math.max(0, identity.daily - used);
}
