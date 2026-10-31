import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { strictBalance, strictIdentityFor } from '@/lib/credit-server';
import { clientIp } from '@/lib/rate-limit';
import { getProStatus } from '@/lib/pro';

/**
 * Authoritative credit balance for the caller.
 * Signed-in → verified NextAuth id. Guests → request IP.
 * Returns { remaining: null } when strict metering isn't configured
 * (local dev), in which case the client-side balance applies.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions).catch(() => null);
  const sessionUserId = session?.user?.id || session?.user?.email || null;
  const membership = await getProStatus(
    sessionUserId,
    session?.user?.email ?? null
  );
  const identity = strictIdentityFor(
    sessionUserId,
    clientIp(req),
    membership.tier
  );
  const remaining = await strictBalance(identity);
  return Response.json({
    remaining,
    daily: identity.daily,
    kind: identity.kind,
    strict: remaining !== null
  }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' }
  });
}
