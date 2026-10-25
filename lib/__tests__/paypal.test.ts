import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  ensurePlan,
  ensureProPlan,
  getSubscription,
  paypalBaseUrl,
  paypalConfigured,
  resetPayPalTokenCache,
  subscriptionBelongsToEmail,
  subscriptionIsPaying
} from '../paypal';

const ENV = { ...process.env };

function stubFetch(
  handler: (url: string, init?: RequestInit) => unknown
): { calls: string[] } {
  const calls: string[] = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push(String(url));
    const body = handler(String(url), init);
    return {
      ok: !String(url).includes('/fail'),
      status: 200,
      json: async () => body
    } as Response;
  }) as typeof fetch;
  return { calls };
}

beforeEach(() => {
  resetPayPalTokenCache();
  process.env.PAYPAL_ENV = 'sandbox';
  process.env.PAYPAL_CLIENT_ID = 'test-id';
  process.env.PAYPAL_CLIENT_SECRET = 'test-secret';
});

afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

describe('paypalBaseUrl / paypalConfigured', () => {
  it('picks sandbox by default, live on request', () => {
    expect(paypalBaseUrl('sandbox')).toContain('sandbox');
    expect(paypalBaseUrl('live')).not.toContain('sandbox');
    process.env.PAYPAL_ENV = 'live';
    expect(paypalBaseUrl()).not.toContain('sandbox');
  });

  it('detects missing credentials', () => {
    expect(paypalConfigured()).toBe(true);
    process.env.PAYPAL_CLIENT_SECRET = '';
    expect(paypalConfigured()).toBe(false);
  });
});

describe('getSubscription', () => {
  it('returns live status and caches the token', async () => {
    const { calls } = stubFetch((url) =>
      url.includes('/oauth2/token')
        ? { access_token: 'tok', expires_in: 3600 }
        : {
            status: 'ACTIVE',
            id: 'sub-1',
            subscriber: { email_address: 'buyer@example.com' }
          }
    );
    const first = await getSubscription('sub-1');
    const second = await getSubscription('sub-1');
    expect(first).toEqual({
      ok: true,
      status: 'ACTIVE',
      planId: null,
      payerEmail: 'buyer@example.com'
    });
    expect(second).toEqual({
      ok: true,
      status: 'ACTIVE',
      planId: null,
      payerEmail: 'buyer@example.com'
    });
    expect(calls.filter((c) => c.includes('/oauth2/token'))).toHaveLength(1);
  });

  it('reports unknown subscriptions and missing config', async () => {
    globalThis.fetch = (async (url: unknown) => {
      if (String(url).includes('/oauth2/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'tok', expires_in: 3600 })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as unknown as typeof fetch;
    expect(await getSubscription('nope')).toEqual({
      ok: false,
      error: 'Subscription not found.'
    });
    process.env.PAYPAL_CLIENT_ID = '';
    expect(await getSubscription('x')).toEqual({
      ok: false,
      error: 'PayPal is not configured.'
    });
  });
});

describe('ensureProPlan', () => {
  it('creates product+plan once, then reuses the stored id', async () => {
    const store = new Map<string, string>();
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      void init;
      if (u.includes('/oauth2/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'tok', expires_in: 3600 })
        };
      }
      if (u.includes('/catalogs/products')) {
        return { ok: true, status: 201, json: async () => ({ id: 'prod-1' }) };
      }
      return { ok: true, status: 201, json: async () => ({ id: 'plan-9' }) };
    }) as unknown as typeof fetch;
    const api = {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => {
        store.set(k, v);
      }
    };
    expect(await ensureProPlan(api)).toBe('plan-9');
    expect(await ensureProPlan(api)).toBe('plan-9');
    expect(store.get('aetheris:paypal:plan:pro')).toBe('plan-9');
  });

  it('keeps separate plans per tier', async () => {
    const store = new Map<string, string>();
    let plans = 0;
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.includes('/oauth2/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'tok', expires_in: 3600 })
        };
      }
      if (u.includes('/catalogs/products')) {
        return { ok: true, status: 201, json: async () => ({ id: 'prod-x' }) };
      }
      plans += 1;
      return { ok: true, status: 201, json: async () => ({ id: `plan-${plans}` }) };
    }) as unknown as typeof fetch;
    const api = {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => {
        store.set(k, v);
      }
    };
    const asteroid = await ensurePlan('asteroid', api);
    const pro = await ensurePlan('pro', api);
    expect(asteroid).not.toBe(pro);
    expect(await ensurePlan('asteroid', api)).toBe(asteroid);
  });
});

describe('subscriptionIsPaying', () => {
  it('accepts only ACTIVE subscriptions', () => {
    expect(subscriptionIsPaying('ACTIVE')).toBe(true);
    expect(subscriptionIsPaying('APPROVED')).toBe(false);
    expect(subscriptionIsPaying('APPROVAL_PENDING')).toBe(false);
    expect(subscriptionIsPaying('CANCELLED')).toBe(false);
    expect(subscriptionIsPaying('SUSPENDED')).toBe(false);
    expect(subscriptionIsPaying('')).toBe(false);
  });

  describe('subscriptionBelongsToEmail', () => {
    it('matches the live PayPal payer email case-insensitively', () => {
      expect(
        subscriptionBelongsToEmail(
          { ok: true, status: 'ACTIVE', planId: 'plan-1', payerEmail: 'Buyer@Example.com' },
          'buyer@example.com'
        )
      ).toBe(true);
    });

    it('rejects mismatched or missing account identity', () => {
      const subscription = {
        ok: true as const,
        status: 'ACTIVE',
        planId: 'plan-1',
        payerEmail: 'buyer@example.com'
      };
      expect(subscriptionBelongsToEmail(subscription, 'another@example.com')).toBe(false);
      expect(subscriptionBelongsToEmail(subscription, null)).toBe(false);
      expect(
        subscriptionBelongsToEmail({ ...subscription, payerEmail: null }, 'buyer@example.com')
      ).toBe(false);
    });
  });
});
