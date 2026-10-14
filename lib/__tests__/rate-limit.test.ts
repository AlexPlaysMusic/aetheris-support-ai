import { describe, expect, it, beforeEach } from 'vitest';
import {
  checkRateLimit,
  clientIp,
  limitRequest,
  rateLimitBucketCount,
  resetRateLimits
} from '../rate-limit';

beforeEach(() => {
  resetRateLimits();
});

describe('checkRateLimit', () => {
  it('allows up to the limit, then blocks', () => {
    expect(checkRateLimit('a', 3, 60_000, 1000).ok).toBe(true);
    expect(checkRateLimit('a', 3, 60_000, 1000).remaining).toBe(1);
    const third = checkRateLimit('a', 3, 60_000, 1000);
    expect(third.ok).toBe(true);
    expect(third.remaining).toBe(0);
    const fourth = checkRateLimit('a', 3, 60_000, 1000);
    expect(fourth.ok).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.resetAfterMs).toBeGreaterThan(0);
  });

  it('resets when the window passes', () => {
    checkRateLimit('a', 1, 1000, 0);
    expect(checkRateLimit('a', 1, 1000, 500).ok).toBe(false);
    expect(checkRateLimit('a', 1, 1000, 1001).ok).toBe(true);
  });

  it('tracks keys independently', () => {
    checkRateLimit('a', 1, 60_000, 0);
    expect(checkRateLimit('a', 1, 60_000, 0).ok).toBe(false);
    expect(checkRateLimit('b', 1, 60_000, 0).ok).toBe(true);
  });

  it('prunes buckets so memory stays bounded', () => {
    for (let i = 0; i < 6000; i++) {
      checkRateLimit(`key-${i}`, 100, 60_000, 0);
    }
    expect(rateLimitBucketCount()).toBeLessThanOrEqual(5000);
  });
});

describe('clientIp', () => {
  it('takes the first forwarded address', () => {
    const req = new Request('http://x/', {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }
    });
    expect(clientIp(req)).toBe('1.2.3.4');
  });

  it('returns null when absent', () => {
    expect(clientIp(new Request('http://x/'))).toBeNull();
  });
});

describe('limitRequest', () => {
  it('returns null while under budget, then a 429 with Retry-After', async () => {
    const opts = { key: 't', limit: 2, windowMs: 60_000 };
    const mk = () =>
      new Request('http://x/', { headers: { 'x-forwarded-for': '9.9.9.9' } });
    expect(limitRequest(mk(), opts)).toBeNull();
    expect(limitRequest(mk(), opts)).toBeNull();
    const blocked = limitRequest(mk(), opts);
    expect(blocked).not.toBeNull();
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get('Retry-After')).toMatch(/^\d+$/);
    const body = (await blocked?.json()) as { error?: string };
    expect(body.error).toBe('RATE_LIMITED');
  });
});
