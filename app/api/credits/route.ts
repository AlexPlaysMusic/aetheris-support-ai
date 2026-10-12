import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { strictBalance, strictIdentityFor } from '@/lib/credit-server';

/**
 * Authoritative credit balance for the caller.
 * Signed-in → verified NextAuth id. Guests → request IP.
 * Returns { remaining: null } when strict metering isn't configured
 * (local dev), in which case the client-side balance applies.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions).catch(() => null);
  const sessionUserId = session?.user?.id || session?.user?.email || null;
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || null;
  const identity = strictIdentityFor(sessionUserId, ip);
  const remaining = await strictBalance(identity);
  return Response.json({
    remaining,
    daily: identity.daily,
    kind: identity.kind,
    strict: remaining !== null
  });
}
