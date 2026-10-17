import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  getProStatus,
  getTier,
  resetProMemory,
  resolveTier,
  setProActive,
  setTierActive
} from '../pro';
import { signPlanCookie } from '../plan-cookie';

beforeEach(() => {
  resetProMemory();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('getProStatus', () => {
  it('guests are never Pro', async () => {
    expect(await getProStatus(null)).toEqual({
      pro: false,
      tier: 'basic',
      subscriptionId: null,
      checkedAt: null
    });
  });

  it('unknown accounts are not Pro', async () => {
    const status = await getProStatus('nobody');
    expect(status.pro).toBe(false);
  });

  it('activates and stays active within the revalidation window', async () => {
    // Any PayPal call here would mean a bug (fresh records skip revalidation).
    globalThis.fetch = (async () => {
      throw new Error('PayPal must not be called for fresh records');
    }) as unknown as typeof fetch;
    await setProActive('user-1', 'sub-9');
    const status = await getProStatus('user-1');
    expect(status.pro).toBe(true);
    expect(status.subscriptionId).toBe('sub-9');
  });

  it('deactivates on cancelled subscriptions after 24h', async () => {
    process.env.PAYPAL_CLIENT_ID = 'id';
    process.env.PAYPAL_CLIENT_SECRET = 'secret';
    await setProActive('user-2', 'sub-old');
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 25 * 3600 * 1000);
    globalThis.fetch = (async (url: unknown) => {
      if (String(url).includes('/oauth2/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'tok', expires_in: 3600 })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'CANCELLED', id: 'sub-old' })
      };
    }) as unknown as typeof fetch;
    const status = await getProStatus('user-2');
    expect(status.pro).toBe(false);
  });

  it('tracks the asteroid tier separately from pro', async () => {
    await setTierActive('user-9', 'asteroid', 'sub-a');
    const status = await getProStatus('user-9');
    expect(status.pro).toBe(false);
    expect(status.tier).toBe('asteroid');
    expect(await getTier('user-9')).toBe('asteroid');
    expect(await getTier(null)).toBe('basic');
  });

  it('stays active when PayPal confirms ACTIVE after 24h', async () => {
    process.env.PAYPAL_CLIENT_ID = 'id';
    process.env.PAYPAL_CLIENT_SECRET = 'secret';
    await setProActive('user-3', 'sub-live');
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 25 * 3600 * 1000);
    globalThis.fetch = (async (url: unknown) => {
      if (String(url).includes('/oauth2/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'tok', expires_in: 3600 })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'ACTIVE', id: 'sub-live' })
      };
    }) as typeof fetch;
    const status = await getProStatus('user-3');
    expect(status.pro).toBe(true);
  });
});

describe('resolveTier (store + signed cookie)', () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = 'test-secret';
  });
  afterEach(() => {
    delete process.env.NEXTAUTH_SECRET;
  });

  it('honours a fresh cookie when the store is empty (cold start)', async () => {
    // Any PayPal call here would mean a bug: a fresh cookie needs no check.
    globalThis.fetch = (async () => {
      throw new Error('PayPal must not be called for a fresh cookie');
    }) as unknown as typeof fetch;
    const cookie = signPlanCookie('cold-1', 'pro', 'sub-cold')!;
    const resolved = await resolveTier('cold-1', cookie);
    expect(resolved.tier).toBe('pro');
    expect(resolved.subscriptionId).toBe('sub-cold');
    expect(resolved.planCookie.set).toBeNull();
  });

  it('gives a tampered/other-user cookie no access', async () => {
    const cookie = signPlanCookie('someone-else', 'pro', 'sub-x')!;
    const resolved = await resolveTier('cold-2', cookie);
    expect(resolved.tier).toBe('basic');
  });

  it('returns basic with no store record and no cookie', async () => {
    const resolved = await resolveTier('cold-3', null);
    expect(resolved.tier).toBe('basic');
  });

  it('prefers the store and mints a cookie for it', async () => {
    await setTierActive('store-1', 'asteroid', 'sub-store');
    const resolved = await resolveTier('store-1', null);
    expect(resolved.tier).toBe('asteroid');
    expect(resolved.subscriptionId).toBe('sub-store');
    expect(resolved.planCookie.set).toBeTruthy();
  });

  it('renews a stale cookie when PayPal confirms the subscription', async () => {
    process.env.PAYPAL_CLIENT_ID = 'id';
    process.env.PAYPAL_CLIENT_SECRET = 'secret';
    globalThis.fetch = (async (url: unknown) => {
      if (String(url).includes('/oauth2/token')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 't', expires_in: 3600 }) };
      }
      return { ok: true, status: 200, json: async () => ({ status: 'ACTIVE', id: 'sub-old' }) };
    }) as unknown as typeof fetch;
    const old = signPlanCookie('stale-1', 'asteroid', 'sub-old', Date.now() - 25 * 3600 * 1000)!;
    const resolved = await resolveTier('stale-1', old);
    expect(resolved.tier).toBe('asteroid');
    expect(resolved.planCookie.set).toBeTruthy();
  });

  it('drops a stale cookie when PayPal says cancelled', async () => {
    process.env.PAYPAL_CLIENT_ID = 'id';
    process.env.PAYPAL_CLIENT_SECRET = 'secret';
    globalThis.fetch = (async (url: unknown) => {
      if (String(url).includes('/oauth2/token')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 't', expires_in: 3600 }) };
      }
      return { ok: true, status: 200, json: async () => ({ status: 'CANCELLED', id: 'sub-dead' }) };
    }) as unknown as typeof fetch;
    const old = signPlanCookie('stale-2', 'pro', 'sub-dead', Date.now() - 25 * 3600 * 1000)!;
    const resolved = await resolveTier('stale-2', old);
    expect(resolved.tier).toBe('basic');
    expect(resolved.planCookie.clear).toBe(true);
  });
});
