import Stripe from 'stripe';
import type { PlanTierStatus } from './pro';

/**
 * Stripe billing (cards): Checkout Sessions for subscribing, webhooks for
 * lifecycle. Card numbers never touch our servers — Stripe hosts checkout.
 *
 * Env:
 *   STRIPE_SECRET_KEY (test key starts sk_test_)
 *   STRIPE_WEBHOOK_SECRET (from the webhook endpoint settings)
 *
 * Plans are auto-created once per tier via lookup keys, so no dashboard
 * product setup is needed — only API keys + the webhook endpoint.
 */

export type PaidPlan = 'asteroid' | 'pro';

const PLAN_CONFIG: Record<
  PaidPlan,
  { lookupKey: string; product: string; amountCents: number }
> = {
  asteroid: {
    lookupKey: 'aetheris-asteroid-monthly',
    product: 'Aetheris Asteroid',
    amountCents: 1000
  },
  pro: {
    lookupKey: 'aetheris-pro-monthly',
    product: 'Aetheris Pro',
    amountCents: 2000
  }
};

let stripe: Stripe | null | undefined;

export function stripeConfigured(): boolean {
  return (process.env.STRIPE_SECRET_KEY ?? '') !== '';
}

/** Lazily constructed client (throws when unconfigured). */
export function getStripe(): Stripe {
  if (stripe !== undefined) return stripe as Stripe;
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (key === '') throw new Error('Stripe is not configured.');
  stripe = new Stripe(key);
  return stripe;
}

/** Test hook: drop the cached client. */
export function resetStripeClient(): void {
  stripe = undefined;
}

function isTier(value: unknown): value is PaidPlan {
  return value === 'asteroid' || value === 'pro';
}

/** Map a Stripe price id back to our tier (pure — tested). */
export function tierFromLookupKey(lookupKey: unknown): PaidPlan | null {
  if (typeof lookupKey !== 'string') return null;
  if (lookupKey === PLAN_CONFIG.asteroid.lookupKey) return 'asteroid';
  if (lookupKey === PLAN_CONFIG.pro.lookupKey) return 'pro';
  return null;
}

/** Extract { userId, tier } from subscription metadata (pure — tested). */
export function membershipFromMetadata(metadata: unknown): {
  userId: string | null;
  tier: PaidPlan | null;
} {
  const record =
    metadata !== null && typeof metadata === 'object'
      ? (metadata as Record<string, unknown>)
      : null;
  const userId =
    record && typeof record['userId'] === 'string' && record['userId'] !== ''
      ? (record['userId'] as string)
      : null;
  const tier = record ? record['tier'] : null;
  return { userId, tier: isTier(tier) ? tier : null };
}

/**
 * Decide what a webhook event means (pure — tested). Returns the action
 * the app should take, or null to ignore the event.
 */
export function routeStripeEvent(event: {
  type: string;
  data: { object: Record<string, unknown> };
}):
  | { action: 'activate'; userId: string; tier: PaidPlan; subscriptionId: string }
  | { action: 'deactivate'; userId: string }
  | null {
  const obj = event.data.object;
  if (event.type === 'checkout.session.completed') {
    const subscriptionId =
      typeof obj['subscription'] === 'string' ? obj['subscription'] : null;
    const { userId, tier } = membershipFromMetadata(obj['metadata']);
    if (subscriptionId && userId && tier) {
      return { action: 'activate', userId, tier, subscriptionId };
    }
    return null;
  }
  if (
    event.type === 'customer.subscription.deleted' ||
    (event.type === 'customer.subscription.updated' &&
      obj['status'] !== 'active' &&
      obj['status'] !== 'trialing')
  ) {
    const { userId } = membershipFromMetadata(obj['metadata']);
    if (userId) return { action: 'deactivate', userId };
    return null;
  }
  return null;
}

/** Find or create the tier's product+price; returns the price id. */
export async function ensureStripePrice(plan: PaidPlan): Promise<string> {
  const client = getStripe();
  const cfg = PLAN_CONFIG[plan];
  const existing = await client.prices.list({
    lookup_keys: [cfg.lookupKey],
    limit: 1
  });
  const found = existing.data[0];
  if (found && found.active) return found.id;

  const product = await client.products.create({
    name: cfg.product,
    type: 'service'
  });
  const price = await client.prices.create({
    unit_amount: cfg.amountCents,
    currency: 'usd',
    recurring: { interval: 'month' },
    product: product.id,
    lookup_key: cfg.lookupKey
  });
  return price.id;
}

/** Tier for a known Stripe price id (checked after lookup). */
export async function tierFromPriceId(priceId: string): Promise<PaidPlan | null> {
  const client = getStripe();
  try {
    const price = await client.prices.retrieve(priceId);
    const lookup =
      typeof price.lookup_key === 'string' ? price.lookup_key : null;
    return tierFromLookupKey(lookup);
  } catch {
    return null;
  }
}
