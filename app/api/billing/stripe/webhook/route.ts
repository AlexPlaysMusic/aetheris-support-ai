import { setTierActive, clearMembership } from '@/lib/pro';
import { getStripe, routeStripeEvent, stripeConfigured } from '@/lib/stripe';

/**
 * Stripe webhook: subscription lifecycle. Signature-verified (the signature
 * IS the auth — no session here). Keep it fast and always 200 on handled
 * events so Stripe stops retrying.
 */
export async function POST(req: Request) {
  if (!stripeConfigured()) {
    return Response.json({ ok: false }, { status: 503 });
  }
  const signature = req.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
  if (!signature || webhookSecret === '') {
    return Response.json({ error: 'Missing webhook signature.' }, { status: 400 });
  }

  try {
    const payload = await req.text();
    const event = getStripe().webhooks.constructEvent(
      payload,
      signature,
      webhookSecret
    ) as unknown as {
      type: string;
      data: { object: Record<string, unknown> };
    };
    const action = routeStripeEvent(event);
    if (!action) return Response.json({ ok: true, ignored: true });

    if (action.action === 'activate') {
      await setTierActive(action.userId, action.tier, action.subscriptionId);
    } else {
      await clearMembership(action.userId);
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[aetheris/stripe-webhook] error:', err);
    return Response.json({ error: 'Webhook failed.' }, { status: 400 });
  }
}
