import { ensurePlan, paypalConfigured, paypalEnv, type PaidTier } from '@/lib/paypal';
import { getSharedRedis } from '@/lib/credit-server';
import { limitRequest } from '@/lib/rate-limit';

const memoryPlan = new Map<string, string>();

/**
 * Returns a tier's billing plan id (?tier=asteroid|pro), creating the
 * product+plan in PayPal on first call. The id is cached (Redis, else memory).
 */
export async function GET(req: Request) {
  const limited = limitRequest(req, { key: 'billing-plan', limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  if (!paypalConfigured()) {
    return Response.json(
      { error: 'Billing is not configured yet.' },
      { status: 503 }
    );
  }
  const requested = new URL(req.url).searchParams.get('tier');
  const tier: PaidTier = requested === 'asteroid' ? 'asteroid' : 'pro';
  const redis = getSharedRedis();
  const store = {
    get: async (key: string): Promise<string | null> => {
      if (redis) {
        try {
          return await redis.get<string>(key);
        } catch {
          /* fall through to memory */
        }
      }
      return memoryPlan.get(key) ?? null;
    },
    set: async (key: string, value: string): Promise<void> => {
      if (redis) {
        try {
          await redis.set(key, value);
          return;
        } catch {
          /* fall through to memory */
        }
      }
      memoryPlan.set(key, value);
    }
  };
  try {
    const planId = await ensurePlan(tier, store);
    return Response.json({ planId, tier, env: paypalEnv() });
  } catch (err) {
    console.error('[aetheris/billing-plan] error:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Could not set up billing.' },
      { status: 500 }
    );
  }
}
