/**
 * Minimal PayPal REST client (no SDK): OAuth tokens, product/plan setup,
 * and subscription verification. Uses global fetch so tests can stub it.
 *
 * Env:
 *   PAYPAL_ENV=sandbox|live (default sandbox — safe)
 *   PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET (REST app credentials)
 */

export type PayPalEnv = 'sandbox' | 'live';

export function paypalEnv(): PayPalEnv {
  return process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox';
}

export function paypalBaseUrl(env: PayPalEnv = paypalEnv()): string {
  return env === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

export function paypalConfigured(): boolean {
  return (
    (process.env.PAYPAL_CLIENT_ID ?? '') !== '' &&
    (process.env.PAYPAL_CLIENT_SECRET ?? '') !== ''
  );
}

type TokenCache = { token: string; expiresAt: number };
let cachedToken: TokenCache | null = null;

/** Test hook: clear the cached access token. */
export function resetPayPalTokenCache(): void {
  cachedToken = null;
}

async function accessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < cachedToken.expiresAt) return cachedToken.token;
  const id = process.env.PAYPAL_CLIENT_ID ?? '';
  const secret = process.env.PAYPAL_CLIENT_SECRET ?? '';
  if (id === '' || secret === '') {
    throw new Error('PayPal is not configured (missing client credentials).');
  }
  const res = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) {
    throw new Error(`PayPal auth failed (${res.status}). Check credentials.`);
  }
  const data = (await res.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof data.access_token !== 'string' || data.access_token === '') {
    throw new Error('PayPal auth returned no token.');
  }
  const ttl =
    typeof data.expires_in === 'number' && data.expires_in > 60
      ? data.expires_in - 60
      : 300;
  cachedToken = { token: data.access_token, expiresAt: now + ttl * 1000 };
  return cachedToken.token;
}

async function paypalFetch(
  path: string,
  init?: RequestInit
): Promise<{ status: number; data: unknown }> {
  const token = await accessToken();
  const res = await fetch(`${paypalBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON error bodies */
  }
  return { status: res.status, data };
}

export type PaidTier = 'asteroid' | 'pro';

const TIER_PLANS: Record<
  PaidTier,
  { product: string; plan: string; price: string }
> = {
  asteroid: {
    product: 'Aetheris Asteroid',
    plan: 'Aetheris Asteroid Monthly',
    price: '10.00'
  },
  pro: {
    product: 'Aetheris Pro',
    plan: 'Aetheris Pro Monthly',
    price: '20.00'
  }
};

function planKey(tier: PaidTier): string {
  return `aetheris:paypal:plan:${tier}`;
}

/**
 * Ensure a tier's product+plan exist, creating them once.
 * getPlanStore abstracts persistence (Redis in prod, memory in tests).
 */
export async function ensurePlan(
  tier: PaidTier,
  store: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<void>;
  }
): Promise<string> {
  const key = planKey(tier);
  const existing = await store.get(key);
  if (existing) return existing;
  const cfg = TIER_PLANS[tier];

  const product = await paypalFetch('/v1/catalogs/products', {
    method: 'POST',
    body: JSON.stringify({
      name: cfg.product,
      description: `${cfg.product} monthly membership.`,
      type: 'SERVICE',
      category: 'SOFTWARE'
    })
  });
  const productId = (product.data as { id?: unknown } | null)?.id;
  if (product.status !== 201 || typeof productId !== 'string') {
    throw new Error('Could not create the PayPal product.');
  }

  const plan = await paypalFetch('/v1/billing/plans', {
    method: 'POST',
    body: JSON.stringify({
      product_id: productId,
      name: cfg.plan,
      description: `${cfg.plan} — $${cfg.price}/month, cancel anytime.`,
      status: 'ACTIVE',
      billing_cycles: [
        {
          frequency: { interval_unit: 'MONTH', interval_count: 1 },
          tenure_type: 'REGULAR',
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: {
            fixed_price: { value: cfg.price, currency_code: 'USD' }
          }
        }
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee_failure_action: 'CONTINUE',
        payment_failure_threshold: 3
      }
    })
  });
  const planId = (plan.data as { id?: unknown } | null)?.id;
  if (plan.status !== 201 || typeof planId !== 'string') {
    throw new Error('Could not create the PayPal billing plan.');
  }
  await store.set(key, planId);
  return planId;
}

/** Backwards-compatible alias (Pro tier). */
export async function ensureProPlan(store: {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
}): Promise<string> {
  return ensurePlan('pro', store);
}

export type SubscriptionState =
  | {
      ok: true;
      status: string;
      planId: string | null;
      payerEmail: string | null;
    }
  | { ok: false; error: string };

/** Fetch a subscription's live status from PayPal. */
export async function getSubscription(
  subscriptionId: string
): Promise<SubscriptionState> {
  if (!paypalConfigured()) {
    return { ok: false, error: 'PayPal is not configured.' };
  }
  try {
    const res = await paypalFetch(
      `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`
    );
    if (res.status === 404) {
      return { ok: false, error: 'Subscription not found.' };
    }
    if (res.status !== 200) {
      return { ok: false, error: `PayPal lookup failed (${res.status}).` };
    }
    const record = (res.data as {
      status?: unknown;
      plan_id?: unknown;
      subscriber?: unknown;
    } | null) ?? {};
    const status = record.status;
    const planId = record.plan_id;
    const subscriber =
      record.subscriber !== null && typeof record.subscriber === 'object'
        ? (record.subscriber as Record<string, unknown>)
        : {};
    const payerEmail = subscriber['email_address'];
    return {
      ok: true,
      status: typeof status === 'string' ? status : 'UNKNOWN',
      planId: typeof planId === 'string' ? planId : null,
      payerEmail: typeof payerEmail === 'string' ? payerEmail.trim() : null
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'PayPal lookup failed.'
    };
  }
}

/** Match a live PayPal subscription to the authenticated account email. */
export function subscriptionBelongsToEmail(
  subscription: SubscriptionState,
  accountEmail: string | null
): boolean {
  if (!subscription.ok || !accountEmail || !subscription.payerEmail) return false;
  return subscription.payerEmail.toLowerCase() === accountEmail.trim().toLowerCase();
}

/** Subscription counts as paying when PayPal says ACTIVE (or just approved). */
export function subscriptionIsPaying(status: string): boolean {
  return status === 'ACTIVE' || status === 'APPROVED';
}
