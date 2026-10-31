import { getAetherisInferenceConfig, listAvailableAetherisModels } from '@/lib/aetheris-inference';
import { apiError, authorizePublicApiRequest } from '@/lib/aetheris-public-api';

export const runtime = 'nodejs';
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const authorization = await authorizePublicApiRequest(req);
  if ('response' in authorization) return authorization.response;

  try {
    const config = getAetherisInferenceConfig();
    const models = await listAvailableAetherisModels(config);
    return Response.json(
      {
        object: 'list',
        data: models.map((model) => ({
          id: model.id,
          object: 'model',
          created: 0,
          owned_by: 'aetheris',
          name: model.label
        }))
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[aetheris/public-api] model listing failed:', error);
    return apiError('Aetheris inference is not available.', 503, 'server_error');
  }
}
