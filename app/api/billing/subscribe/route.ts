import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSubscription, subscriptionIsPaying } from '@/lib/paypal';
import { setProActive } from '@/lib/pro';
import { limitRequest } from '@/lib/rate-limit';

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

  await setProActive(userId, subscriptionId);
  return Response.json({ ok: true, pro: true });
}
