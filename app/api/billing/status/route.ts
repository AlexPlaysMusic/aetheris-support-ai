import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getProStatus } from '@/lib/pro';
import { limitRequest } from '@/lib/rate-limit';

/** Pro membership state for the caller (revalidated at most daily). */
export async function GET(req: Request) {
  const limited = limitRequest(req, { key: 'billing-status', limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const session = await getServerSession(authOptions).catch(() => null);
  const userId = session?.user?.id || session?.user?.email || null;
  const status = await getProStatus(userId);
  return Response.json(status);
}
