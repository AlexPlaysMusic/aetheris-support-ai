import { ensureProPlan, paypalConfigured, paypalEnv } from '@/lib/paypal';
import { getSharedRedis } from '@/lib/credit-server';
import { limitRequest } from '@/lib/rate-limit';

const memoryPlan = new Map<string, string>();

/**
 * Returns the Pro billing plan id, creating the $20/mo product+plan in
 * PayPal on first call. The id is cached (Redis, else memory).
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
    const planId = await ensureProPlan(store);
    return Response.json({ planId, env: paypalEnv() });
  } catch (err) {
    console.error('[aetheris/billing-plan] error:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Could not set up billing.' },
      { status: 500 }
    );
  }
}
