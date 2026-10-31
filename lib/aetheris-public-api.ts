import {
  authenticateApiKey,
  checkApiKeyRateLimit,
  recordApiKeyUsage,
  type ApiKeyRecord
} from './aetheris-api-keys';

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
