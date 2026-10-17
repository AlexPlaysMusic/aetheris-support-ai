import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getStripe, stripeConfigured } from '@/lib/stripe';
import { setTierActive } from '@/lib/pro';
import { signPlanCookie, serializePlanCookie } from '@/lib/plan-cookie';
import { limitRequest } from '@/lib/rate-limit';

/**
 * Confirm a completed Checkout Session (the /billing/success return page
 * calls this): verifies payment with Stripe directly, then activates the
 * tier from the subscription metadata. The logged-in user must match.
 */
export async function POST(req: Request) {
  const limited = limitRequest(req, { key: 'stripe-verify', limit: 10, windowMs: 60_000 });
  if (limited) return limited;
  if (!stripeConfigured()) {
    return Response.json(
      { error: 'Card payments are not configured yet.' },
      { status: 503 }
    );
  }

  const session = await getServerSession(authOptions).catch(() => null);
  const userId = session?.user?.id || session?.user?.email || null;
  if (!userId) {
    return Response.json({ error: 'Sign in first.' }, { status: 401 });
  }

  const body: unknown = await req.json().catch(() => null);
  const record =
    body !== null && typeof body === 'object'
      ? (body as Record<string, unknown>)
      : {};
  const sessionId =
    typeof record['sessionId'] === 'string' ? record['sessionId'].trim() : '';
  if (sessionId === '') {
    return Response.json({ error: 'Missing checkout session.' }, { status: 400 });
  }

  try {
    const checkout = await getStripe().checkout.sessions.retrieve(sessionId);
    if (
      checkout.payment_status !== 'paid' ||
      checkout.status !== 'complete' ||
      typeof checkout.subscription !== 'string'
    ) {
      return Response.json(
        { error: 'Payment is not complete yet.' },
        { status: 402 }
      );
    }
    const subscription = await getStripe().subscriptions.retrieve(
      checkout.subscription
    );
    const meta = (subscription.metadata ?? {}) as Record<string, unknown>;
    const tier = meta['tier'] === 'asteroid' ? 'asteroid' : 'pro';
    const owner =
      typeof meta['userId'] === 'string' && meta['userId'] !== ''
        ? meta['userId']
        : (typeof checkout.client_reference_id === 'string' &&
          checkout.client_reference_id !== ''
          ? checkout.client_reference_id
          : null);
    if (owner !== userId) {
      return Response.json(
        { error: 'This checkout belongs to a different account.' },
        { status: 403 }
      );
    }
    const active =
      subscription.status === 'active' || subscription.status === 'trialing';
    if (!active) {
      return Response.json(
        { error: `Subscription is ${subscription.status}.` },
        { status: 402 }
      );
    }
    await setTierActive(userId, tier, subscription.id);
    const headers = new Headers();
    const cookie = signPlanCookie(userId, tier, subscription.id);
    if (cookie) headers.append('Set-Cookie', serializePlanCookie(cookie));
    return Response.json({ ok: true, tier }, { headers });
  } catch (err) {
    console.error('[aetheris/stripe-verify] error:', err);
    return Response.json(
      { error: 'Could not confirm payment. Try again.' },
      { status: 500 }
    );
  }
}
