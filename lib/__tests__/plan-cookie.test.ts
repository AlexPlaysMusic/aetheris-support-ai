import { describe, expect, it } from 'vitest';
import {
  clearPlanCookieHeader,
  getCookieValue,
  PLAN_COOKIE_NAME,
  serializePlanCookie,
  signPlanCookie,
  verifyPlanCookie
} from '../plan-cookie';

const SECRET_ENV = 'NEXTAUTH_SECRET';

describe('plan-cookie', () => {
  it('round-trips a valid cookie and binds it to the user', () => {
    process.env[SECRET_ENV] = 'shh';
    const value = signPlanCookie('user-1', 'pro', 'sub-9') as string;
    expect(value).toBeTruthy();
    const verified = verifyPlanCookie(value, 'user-1');
    expect(verified).toMatchObject({
      tier: 'pro',
      subscriptionId: 'sub-9',
      stale: false
    });
    // Wrong user cannot reuse it.
    expect(verifyPlanCookie(value, 'someone-else')).toBeNull();
    delete process.env[SECRET_ENV];
  });

  it('rejects forged, malformed and expired cookies', () => {
    process.env[SECRET_ENV] = 'shh';
    const value = signPlanCookie('user-1', 'pro', 'sub-9') as string;
    // Tampered body.
    const parts = value.split('.');
    const tampered = `${parts[0]}.${parts[1].slice(0, -3)}xxx.${parts[2]}`;
    expect(verifyPlanCookie(tampered, 'user-1')).toBeNull();
    // Wrong signature.
    const wrongSig = `${parts[0]}.${parts[1]}.${'0'.repeat(parts[2].length)}`;
    expect(verifyPlanCookie(wrongSig, 'user-1')).toBeNull();
    // Garbage.
    expect(verifyPlanCookie('nope', 'user-1')).toBeNull();
    expect(verifyPlanCookie('', 'user-1')).toBeNull();
    expect(verifyPlanCookie(value, '')).toBeNull();
    // Expired.
    const expired = signPlanCookie('user-1', 'pro', 'sub-9', Date.now() - 8 * 86400_000) as string;
    expect(verifyPlanCookie(expired, 'user-1')).toBeNull();
    delete process.env[SECRET_ENV];
  });

  it('marks cookies older than 24h as stale but still valid', () => {
    process.env[SECRET_ENV] = 'shh';
    const old = signPlanCookie('u', 'asteroid', 'sub-2', Date.now() - 25 * 3600_000) as string;
    const v = verifyPlanCookie(old, 'u');
    expect(v?.tier).toBe('asteroid');
    expect(v?.stale).toBe(true);
    delete process.env[SECRET_ENV];
  });

  it('refuses to sign without a secret or valid tier', () => {
    expect(signPlanCookie('u', 'pro', 'sub')).toBeNull();
    process.env[SECRET_ENV] = 'shh';
    expect(signPlanCookie('', 'pro', 'sub')).toBeNull();
    expect(signPlanCookie('u', 'pro', '')).toBeNull();
    expect(signPlanCookie('u', 'basic' as never, 'sub')).toBeNull();
    delete process.env[SECRET_ENV];
  });

  it('serializes and clears cookies with the right flags', () => {
    // jsdom/tsc may mark NODE_ENV readonly; serialize logic still runs.
    const serialized = serializePlanCookie('v1.a.b');
    expect(serialized).toContain(`${PLAN_COOKIE_NAME}=v1.a.b`);
    expect(serialized).toContain('Path=/');
    expect(serialized).toContain('HttpOnly');
    expect(serialized).toContain('SameSite=Lax');
    expect(serialized).toContain('Max-Age=');
    const cleared = clearPlanCookieHeader();
    expect(cleared).toContain('Max-Age=0');
  });

  it('reads a single cookie out of a header', () => {
    const header = 'foo=bar; aetheris_plan=hello%20world; baz=qux';
    expect(getCookieValue(header, 'aetheris_plan')).toBe('hello world');
    expect(getCookieValue(header, 'foo')).toBe('bar');
    expect(getCookieValue(header, 'missing')).toBeNull();
    expect(getCookieValue(null, 'aetheris_plan')).toBeNull();
  });
});
