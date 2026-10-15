import { paypalConfigured } from '@/lib/paypal';
import { stripeConfigured } from '@/lib/stripe';
import { limitRequest } from '@/lib/rate-limit';

/** Which payment rails are configured (drives the upgrade dialog). */
export async function GET(req: Request) {
  const limited = limitRequest(req, { key: 'billing-methods', limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  return Response.json({
    paypal: paypalConfigured(),
    stripe: stripeConfigured()
  });
}
