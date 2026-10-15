import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { ensureStripePrice, stripeConfigured } from '@/lib/stripe';
import { limitRequest } from '@/lib/rate-limit';

/**
 * Start a card subscription: creates a Stripe Checkout Session and returns
 * its URL for redirect. Tier comes from the request; price lookup is
 * server-side so buyers can't swap amounts.
 */
export async function POST(req: Request) {
  const limited = limitRequest(req, { key: 'stripe-checkout', limit: 10, windowMs: 60_000 });
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
    return Response.json(
      { error: 'Sign in to subscribe.' },
      { status: 401 }
    );
  }

  const body: unknown = await req.json().catch(() => null);
  const record =
    body !== null && typeof body === 'object'
      ? (body as Record<string, unknown>)
      : {};
  const tier = record['tier'] === 'asteroid' ? 'asteroid' : 'pro';

  try {
    const priceId = await ensureStripePrice(tier);
    const origin =
      process.env.NEXTAUTH_URL ??
      new URL(req.url).origin;
    const { getStripe } = await import('@/lib/stripe');
    const checkout = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: origin,
      client_reference_id: userId,
      customer_email: session?.user?.email ?? undefined,
      subscription_data: {
        metadata: { userId, tier }
      }
    });
    if (!checkout.url) throw new Error('Checkout session has no URL.');
    return Response.json({ ok: true, url: checkout.url });
  } catch (err) {
    console.error('[aetheris/stripe-checkout] error:', err);
    return Response.json(
      { error: 'Could not start checkout. Try again.' },
      { status: 500 }
    );
  }
}
