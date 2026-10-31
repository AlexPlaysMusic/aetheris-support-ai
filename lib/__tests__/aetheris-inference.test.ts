import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  findAetherisModel,
  getAetherisInferenceConfig
} from '../aetheris-inference';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Aetheris inference configuration', () => {
  it('does not advertise models until inference is configured', () => {
    vi.stubEnv('AETHERIS_INFERENCE_BASE_URL', '');
    vi.stubEnv('AETHERIS_INFERENCE_API_KEY', '');
    vi.stubEnv('AETHERIS_MODELS_JSON', '[]');

    expect(getAetherisInferenceConfig()).toMatchObject({
      baseUrl: '',
      apiKey: '',
      models: []
    });
  });

  it('maps public Aetheris model IDs to configured inference model IDs', () => {
    vi.stubEnv('AETHERIS_INFERENCE_BASE_URL', 'http://localhost:8000/v1');
    vi.stubEnv('AETHERIS_INFERENCE_API_KEY', 'local-test-key');
    vi.stubEnv(
      'AETHERIS_MODELS_JSON',
      JSON.stringify([
        {
          id: 'aetheris-basic',
          upstreamModel: 'local/model-id',
          label: 'Basic',
          maxTokens: 1024
        }
      ])
    );
    const config = getAetherisInferenceConfig();

    expect(findAetherisModel('aetheris-basic', config)).toMatchObject({
      id: 'aetheris-basic',
      upstreamModel: 'local/model-id',
      maxTokens: 1024
    });
    expect(findAetherisModel('aetheris-pro', config)).toBeNull();
  });

  it('rejects invalid aliases and malformed model configuration', () => {
    vi.stubEnv(
      'AETHERIS_MODELS_JSON',
      JSON.stringify([{ id: 'provider-model', upstreamModel: 'model' }])
    );
    expect(() => getAetherisInferenceConfig()).toThrow(
      'Aetheris model ids must start with aetheris-.'
    );
  });

  it('requires HTTPS for non-local inference servers', () => {
    vi.stubEnv('AETHERIS_INFERENCE_BASE_URL', 'http://inference.example.com/v1');
    expect(() => getAetherisInferenceConfig()).toThrow(
      'Aetheris inference must use HTTPS outside localhost.'
    );
  });
});
