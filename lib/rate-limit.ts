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
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const safeWindowMs = Number.isFinite(windowMs) ? Math.max(0, Math.floor(windowMs)) : 0;
  if (safeLimit <= 0 || safeWindowMs <= 0) {
    return { ok: false, remaining: 0, resetAfterMs: 0 };
  }

  prune(now);
  const current = buckets.get(key);
  if (!current || now >= current.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + safeWindowMs });
    return { ok: true, remaining: Math.max(0, safeLimit - 1), resetAfterMs: safeWindowMs };
  }
  if (current.count >= safeLimit) {
    return { ok: false, remaining: 0, resetAfterMs: Math.max(0, current.resetAt - now) };
  }
  current.count += 1;
  return {
    ok: true,
    remaining: safeLimit - current.count,
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

/** Best-effort client IP across common reverse-proxy headers. */
export function clientIp(req: Request): string | null {
  const candidates = [
    req.headers.get('x-forwarded-for'),
    req.headers.get('x-real-ip'),
    req.headers.get('cf-connecting-ip'),
    req.headers.get('true-client-ip'),
    req.headers.get('fastly-client-ip'),
    req.headers.get('forwarded')
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const raw = candidate.includes(',') ? candidate.split(',')[0] : candidate;
    const ip = raw.trim().replace(/^for=/i, '').replace(/^"|"$/g, '');
    if (ip === '') continue;
    let cleaned = ip.replace(/^"|"$/g, '').trim();
    if (cleaned.startsWith('[') && cleaned.includes(']')) {
      cleaned = cleaned.slice(1, cleaned.indexOf(']'));
    } else if (cleaned.includes(':') && cleaned.includes('.')) {
      cleaned = cleaned.replace(/:\d+$/, '');
    }
    if (cleaned !== '') return cleaned;
  }
  return null;
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
