import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  ensurePlan,
  getSubscription,
  subscriptionIsPaying,
  type PaidTier
} from '@/lib/paypal';
import { getSharedRedis } from '@/lib/credit-server';
import { setTierActive } from '@/lib/pro';
import { limitRequest } from '@/lib/rate-limit';

const memoryPlanIds = new Map<string, string>();

/**
 * Activate Pro after the buyer approves in PayPal. The subscription id
 * comes from the PayPal Buttons onApprove callback — and is VERIFIED
 * against PayPal's API here (never trusted blindly) before the flag flips.
 */
export async function POST(req: Request) {
  const limited = limitRequest(req, { key: 'billing-subscribe', limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const session = await getServerSession(authOptions).catch(() => null);
  const userId = session?.user?.id || session?.user?.email || null;
  if (!userId) {
    return Response.json(
      { error: 'Sign in to subscribe to Pro.' },
      { status: 401 }
    );
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
  if (subscriptionId === '') {
    return Response.json(
      { error: 'Missing PayPal subscription id.' },
      { status: 400 }
    );
  }
  const tier: PaidTier =
    record['tier'] === 'asteroid' ? 'asteroid' : 'pro';

  const live = await getSubscription(subscriptionId);
  if (!live.ok) {
    return Response.json({ error: live.error }, { status: 502 });
  }
  if (!subscriptionIsPaying(live.status)) {
    return Response.json(
      { error: `Subscription is ${live.status} — not active yet. Finish checkout, then retry.` },
      { status: 402 }
    );
  }

  // The subscription must belong to the plan being bought — a $10 approval
  // can never unlock the $20 tier.
  const redis = getSharedRedis();
  const planStore = {
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
  const expectedPlanId = await ensurePlan(tier, planStore).catch(() => null);
  if (expectedPlanId && live.planId && live.planId !== expectedPlanId) {
    return Response.json(
      { error: 'This subscription is for a different plan.' },
      { status: 400 }
    );
  }

  await setTierActive(userId, tier, subscriptionId);
  return Response.json({ ok: true, tier });
}
