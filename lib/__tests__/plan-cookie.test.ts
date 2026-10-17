import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  PLAN_COOKIE_NAME,
  PLAN_COOKIE_TTL_MS,
  PLAN_COOKIE_REVALIDATE_AFTER_MS,
  signPlanCookie,
  verifyPlanCookie,
  serializePlanCookie,
  clearPlanCookieHeader,
  getCookieValue
} from '../plan-cookie';

const SECRET = 'test-secret-please-change';

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.NEXTAUTH_SECRET;
});

describe('signPlanCookie / verifyPlanCookie', () => {
  it('round-trips a pro cookie', () => {
    const value = signPlanCookie('user-1', 'pro', 'sub-1');
    expect(value).toBeTruthy();
    const verified = verifyPlanCookie(value, 'user-1');
    expect(verified).not.toBeNull();
    expect(verified!.tier).toBe('pro');
    expect(verified!.subscriptionId).toBe('sub-1');
    expect(verified!.stale).toBe(false);
  });

  it('round-trips an asteroid cookie', () => {
    const value = signPlanCookie('user-2', 'asteroid', 'sub-2');
    const verified = verifyPlanCookie(value, 'user-2');
    expect(verified!.tier).toBe('asteroid');
  });

  it('refuses to sign for a basic tier or missing fields', () => {
    expect(signPlanCookie('user-1', 'basic' as never, 'sub-1')).toBeNull();
    expect(signPlanCookie('', 'pro', 'sub-1')).toBeNull();
    expect(signPlanCookie('user-1', 'pro', '')).toBeNull();
  });

  it('returns null when there is no signing secret', () => {
    delete process.env.NEXTAUTH_SECRET;
    expect(signPlanCookie('user-1', 'pro', 'sub-1')).toBeNull();
    const value = signPlanCookie('user-1', 'pro', 'sub-1');
    expect(verifyPlanCookie(value, 'user-1')).toBeNull();
  });

  it('rejects a cookie minted for a different user', () => {
    const forged = signPlanCookie('someone-else', 'pro', 'sub-1');
    expect(verifyPlanCookie(forged, 'user-1')).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const value = signPlanCookie('user-1', 'asteroid', 'sub-1')!;
    const parts = value.split('.');
    const evilPayload = Buffer.from(
      JSON.stringify({ u: 'user-1', t: 'pro', s: 'sub-1', iat: Date.now() })
    ).toString('base64url');
    const tampered = `v1.${evilPayload}.${parts[2]}`;
    expect(verifyPlanCookie(tampered, 'user-1')).toBeNull();
  });

  it('rejects garbage and wrong versions', () => {
    expect(verifyPlanCookie('', 'user-1')).toBeNull();
    expect(verifyPlanCookie('v1.notbase64.notasig', 'user-1')).toBeNull();
    expect(verifyPlanCookie('v2.payload.sig', 'user-1')).toBeNull();
    expect(verifyPlanCookie('only-one-part', 'user-1')).toBeNull();
  });

  it('marks cookies stale after the revalidation window but still authentic', () => {
    const now = Date.now();
    const value = signPlanCookie('user-1', 'pro', 'sub-1', now)!;
    const later = now + PLAN_COOKIE_REVALIDATE_AFTER_MS + 1000;
    const verified = verifyPlanCookie(value, 'user-1', later);
    expect(verified).not.toBeNull();
    expect(verified!.stale).toBe(true);
  });

  it('rejects cookies past the absolute TTL', () => {
    const now = Date.now();
    const value = signPlanCookie('user-1', 'pro', 'sub-1', now)!;
    const tooLate = now + PLAN_COOKIE_TTL_MS + 1000;
    expect(verifyPlanCookie(value, 'user-1', tooLate)).toBeNull();
  });
});

describe('serializePlanCookie', () => {
  it('sets HttpOnly, SameSite and an absolute Max-Age', () => {
    const header = serializePlanCookie('v1.abc.def');
    expect(header.startsWith(`${PLAN_COOKIE_NAME}=`)).toBe(true);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=604800');
  });

  it('honours a custom max age', () => {
    expect(serializePlanCookie('v1.abc.def', 60)).toContain('Max-Age=60');
  });

  it('clears with Max-Age=0', () => {
    expect(clearPlanCookieHeader()).toContain('Max-Age=0');
  });
});

describe('getCookieValue', () => {
  it('finds a cookie among many', () => {
    const header = 'a=1; aetheris_plan=v1.abc.def; other=2';
    expect(getCookieValue(header, PLAN_COOKIE_NAME)).toBe('v1.abc.def');
  });

  it('decodes URL-encoded values', () => {
    expect(getCookieValue('x=a%20b', 'x')).toBe('a b');
  });

  it('returns null when missing or empty header', () => {
    expect(getCookieValue('a=1', PLAN_COOKIE_NAME)).toBeNull();
    expect(getCookieValue(null, PLAN_COOKIE_NAME)).toBeNull();
  });
});
