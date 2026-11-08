import {
  authenticateApiKey,
  checkApiKeyRateLimit,
  recordApiKeyUsage,
  type ApiKeyRecord
} from './aetheris-api-keys';
import { resolveTier, type PlanTierStatus } from './pro';
import { getSubscription, subscriptionIsPaying } from './paypal';

/**
 * The key owner's effective membership tier. Starts from the account's
 * stored/cookie state, then falls back to the membership claim embedded in
 * the key — which is only honored after a live PayPal check, so a claim
 * alone never grants paid access and cancels lapse within one request.
 */
export async function resolveKeyOwnerTier(
  record: ApiKeyRecord
): Promise<PlanTierStatus> {
  let tier: PlanTierStatus = 'basic';
  try {
    tier = (await resolveTier(record.ownerId, null, null)).tier;
  } catch {
    tier = 'basic';
  }
  if (tier !== 'basic') return tier;
  if (!record.claimTier || !record.claimSubscriptionId) return 'basic';
  try {
    const live = await getSubscription(record.claimSubscriptionId);
    if (live.ok && subscriptionIsPaying(live.status)) return record.claimTier;
  } catch {
    // PayPal unreachable: fail closed to basic.
  }
  return 'basic';
}

/** Server-side gate: paid aliases require the key owner's membership. */
export function modelAllowedForTier(modelId: string, tier: PlanTierStatus): boolean {
  if (modelId === 'aetheris-pro') return tier === 'pro';
  if (modelId === 'aetheris-asteroid') return tier !== 'basic';
  return true;
}

export async function authorizePublicApiRequest(
  req: Request
): Promise<{ record: ApiKeyRecord } | { response: Response }> {
  let record: ApiKeyRecord | null;
  try {
    record = await authenticateApiKey(req.headers.get('authorization'));
  } catch (error) {
    console.error('[aetheris/public-api] API key verification unavailable:', error);
    return {
      response: Response.json(
        { error: { message: 'API authentication is temporarily unavailable.', type: 'server_error' } },
        { status: 503 }
      )
    };
  }
  if (!record) {
    return {
      response: Response.json(
        { error: { message: 'A valid Bearer API key is required.', type: 'authentication_error' } },
        { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } }
      )
    };
  }

  const rawLimit = Number(process.env.AETHERIS_API_RATE_LIMIT_PER_MINUTE ?? 60);
  const limit =
    Number.isFinite(rawLimit) && rawLimit >= 1
      ? Math.min(600, Math.floor(rawLimit))
      : 60;
  try {
    if (!(await checkApiKeyRateLimit(record.id, limit))) {
      return {
        response: Response.json(
          { error: { message: 'Rate limit exceeded. Retry in a minute.', type: 'rate_limit_error' } },
          {
            status: 429,
            headers: { 'Retry-After': '60' }
          }
        )
      };
    }
    await recordApiKeyUsage(record.id);
  } catch (error) {
    console.error('[aetheris/public-api] API usage storage unavailable:', error);
    return {
      response: Response.json(
        { error: { message: 'API usage storage is temporarily unavailable.', type: 'server_error' } },
        { status: 503 }
      )
    };
  }
  return { record };
}

export function apiError(
  message: string,
  status: number,
  type: string = 'invalid_request_error'
): Response {
  return Response.json({ error: { message, type } }, { status });
}
