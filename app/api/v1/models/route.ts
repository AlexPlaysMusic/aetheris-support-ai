import {
  listAvailableAetherisModels,
  resolveInferenceConfig
} from '@/lib/aetheris-inference';
import {
  apiError,
  authorizePublicApiRequest,
  modelAllowedForTier,
  resolveKeyOwnerTier
} from '@/lib/aetheris-public-api';

export const runtime = 'nodejs';
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const authorization = await authorizePublicApiRequest(req);
  if ('response' in authorization) return authorization.response;

  try {
    const config = resolveInferenceConfig();
    if (config.mode === 'none') {
      return apiError('Aetheris inference is not configured.', 503, 'server_error');
    }
    const tier = await resolveKeyOwnerTier(authorization.record);
    // Relay mode serves the configured aliases directly (no upstream probe —
    // the relay's alias list mirrors the website). A configured host is
    // queried live so only actually-loaded models are advertised.
    const models =
      config.mode === 'gemini'
        ? config.models
        : await listAvailableAetherisModels(config);
    return Response.json(
      {
        object: 'list',
        data: models
          .filter((model) => modelAllowedForTier(model.id, tier))
          .map((model) => ({
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
