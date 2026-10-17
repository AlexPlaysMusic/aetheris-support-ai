import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  ensurePlan,
  getSubscription,
  paypalConfigured,
  subscriptionIsPaying,
  type PaidTier
} from '@/lib/paypal';
import { getStripe, stripeConfigured, tierFromPriceId } from '@/lib/stripe';
import { getSharedRedis } from '@/lib/credit-server';
import { setTierActive } from '@/lib/pro';
import { signPlanCookie, serializePlanCookie } from '@/lib/plan-cookie';
import { limitRequest } from '@/lib/rate-limit';

const memoryPlanIds = new Map<string, string>();

function planStore() {
  const redis = getSharedRedis();
  return {
    get: async (key: string): Promise<string | null> => {
      if (!redis) return memoryPlanIds.get(key) ?? null;
      try {
        return await redis.get<string>(key);
      } catch {
        return memoryPlanIds.get(key) ?? null;
      }
    },
    set: async (key: string, value: string): Promise<void> => {
      memoryPlanIds.set(key, value);
      if (!redis) return;
      try {
        await redis.set(key, value);
      } catch {
        /* ignore */
      }
    }
  };
}

/** Which of our paid tiers a PayPal plan id belongs to. */
async function tierFromPayPalPlanId(planId: string): Promise<PaidTier | null> {
  const store = planStore();
  const tiers: PaidTier[] = ['asteroid', 'pro'];
  for (const tier of tiers) {
    const expected = await ensurePlan(tier, store).catch(() => null);
    if (expected && expected === planId) return tier;
  }
  return null;
}

/**
 * Restore a purchase the caller already paid for but whose entitlement
 * was lost (cleared cookies, new device). Two paths:
 *   - Card: look up the signed-in email's Stripe customer + subscription.
 *   - PayPal: verify a subscription id the buyer provides.
 * Either way the tier is confirmed live before anything is unlocked.
 */
export async function POST(req: Request) {
  const limited = limitRequest(req, { key: 'billing-restore', limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const session = await getServerSession(authOptions).catch(() => null);
  const userId = session?.user?.id || session?.user?.email || null;
  const email = session?.user?.email ?? null;
  if (!userId) {
    return Response.json({ error: 'Sign in to restore a purchase.' }, { status: 401 });
  }

  const body: unknown = await req.json().catch(() => null);
  const record =
    body !== null && typeof body === 'object'
      ? (body as Record<string, unknown>)
      : {};
  const subscriptionId =
    typeof record['subscriptionId'] === 'string'
      ? record['subscriptionId'].trim()
      : '';

  // ---- Stripe: find an active subscription on the signed-in email ----
  if (stripeConfigured() && email) {
    try {
      const client = getStripe();
      const customers = await client.customers.list({ email, limit: 1 });
      const customer = customers.data[0];
      if (customer) {
        const subs = await client.subscriptions.list({
          customer: customer.id,
          status: 'all',
          limit: 10
        });
        for (const sub of subs.data) {
          if (sub.status !== 'active' && sub.status !== 'trialing') continue;
          const priceId = sub.items.data[0]?.price?.id;
          if (!priceId) continue;
          const tier = await tierFromPriceId(priceId);
          if (!tier) continue;
          await setTierActive(userId, tier, sub.id);
          const headers = new Headers();
          const cookie = signPlanCookie(userId, tier, sub.id);
          if (cookie) headers.append('Set-Cookie', serializePlanCookie(cookie));
          return Response.json(
            { ok: true, tier, source: 'stripe' },
            { headers }
          );
        }
      }
    } catch (err) {
      console.error('[aetheris/restore] stripe lookup failed:', err);
    }
  }

  // ---- PayPal: verify a subscription id the buyer pasted ----
  if (subscriptionId !== '') {
    if (!paypalConfigured()) {
      return Response.json(
        { error: 'PayPal is not configured on this server.' },
        { status: 503 }
      );
    }
    const live = await getSubscription(subscriptionId);
    if (!live.ok) {
      return Response.json({ error: live.error }, { status: 502 });
    }
    if (!subscriptionIsPaying(live.status)) {
      return Response.json(
        { error: `That subscription is ${live.status} — nothing to restore.` },
        { status: 402 }
      );
    }
    const tier =
      live.planId !== null ? await tierFromPayPalPlanId(live.planId) : null;
    if (!tier) {
      return Response.json(
        { error: 'That subscription does not match an Aetheris plan.' },
        { status: 400 }
      );
    }
    await setTierActive(userId, tier, subscriptionId);
    const headers = new Headers();
    const cookie = signPlanCookie(userId, tier, subscriptionId);
    if (cookie) headers.append('Set-Cookie', serializePlanCookie(cookie));
    return Response.json({ ok: true, tier, source: 'paypal' }, { headers });
  }

  return Response.json(
    {
      error:
        stripeConfigured()
          ? 'No active card subscription found for your email. Paste your PayPal subscription id below.'
          : 'Paste the PayPal subscription id from your receipt to restore access.'
    },
    { status: 404 }
  );
}
