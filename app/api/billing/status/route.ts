import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { resolveTier } from '@/lib/pro';
import {
  PLAN_COOKIE_NAME,
  getCookieValue,
  serializePlanCookie,
  clearPlanCookieHeader
} from '@/lib/plan-cookie';
import { limitRequest } from '@/lib/rate-limit';

/** Pro membership state for the caller (revalidated at most daily). */
export async function GET(req: Request) {
  const limited = limitRequest(req, { key: 'billing-status', limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const session = await getServerSession(authOptions).catch(() => null);
  const userId = session?.user?.id || session?.user?.email || null;
  const cookieValue = getCookieValue(req.headers.get('cookie'), PLAN_COOKIE_NAME);
  const resolved = await resolveTier(userId, cookieValue, session?.user?.email ?? null);

  const headers = new Headers();
  if (resolved.planCookie.set) {
    headers.append('Set-Cookie', serializePlanCookie(resolved.planCookie.set));
  } else if (resolved.planCookie.clear) {
    headers.append('Set-Cookie', clearPlanCookieHeader());
  }

  return Response.json(
    {
      pro: resolved.tier === 'pro',
      tier: resolved.tier,
      subscriptionId: resolved.subscriptionId,
      checkedAt: resolved.tier === 'basic' ? null : Date.now()
    },
    { headers }
  );
}
