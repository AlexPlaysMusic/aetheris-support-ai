/**
 * Tiny fixed-window IP rate limiter (no dependencies).
 *
 * Why in-memory: it works identically on Vercel serverless, a VPS, and
 * local dev with zero setup. Trade-off to know: on serverless each
 * instance keeps its own buckets, so a distributed flood can partially
 * bypass it — it stops casual spam and accidents, not botnets. Credit
 * spend (the expensive part) is metered separately in Redis.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

const MAX_BUCKETS = 5000;

function prune(now: number): void {
  if (buckets.size <= MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
    if (buckets.size < MAX_BUCKETS) return;
  }
  // Still over budget (flood of distinct keys in one window): evict
  // oldest first, leaving room for the incoming entry. Worst case someone
  // gets a fresh bucket — acceptable for abuse control, and memory stays
  // bounded no matter what.
  for (const key of buckets.keys()) {
    if (buckets.size < MAX_BUCKETS) break;
    buckets.delete(key);
  }
}

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetAfterMs: number;
};

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now()
): RateLimitResult {
  prune(now);
  const current = buckets.get(key);
  if (!current || now >= current.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: Math.max(0, limit - 1), resetAfterMs: windowMs };
  }
  if (current.count >= limit) {
    return { ok: false, remaining: 0, resetAfterMs: Math.max(0, current.resetAt - now) };
  }
  current.count += 1;
  return {
    ok: true,
    remaining: limit - current.count,
    resetAfterMs: Math.max(0, current.resetAt - now)
  };
}

/** Test hook: how many buckets are currently held. */
export function rateLimitBucketCount(): number {
  return buckets.size;
}

/** Test hook: empty all buckets. */
export function resetRateLimits(): void {
  buckets.clear();
}

/** Best-effort client IP (Vercel sets x-forwarded-for). */
export function clientIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim();
  return ip && ip !== '' ? ip : null;
}

/**
 * Route helper: returns a 429 Response when over budget, else null
 * (meaning "proceed"). Usage: `const limited = limitRequest(req, {...});
 * if (limited) return limited;`
 */
export function limitRequest(
  req: Request,
  opts: { key: string; limit: number; windowMs: number }
): Response | null {
  const result = checkRateLimit(
    `${opts.key}:${clientIp(req) ?? 'unknown'}`,
    opts.limit,
    opts.windowMs
  );
  if (result.ok) return null;
  return Response.json(
    {
      error: 'RATE_LIMITED',
      message: 'Too many requests — please slow down and try again shortly.'
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(Math.max(1, Math.ceil(result.resetAfterMs / 1000)))
      }
    }
  );
}
