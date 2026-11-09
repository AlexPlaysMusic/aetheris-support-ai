import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  findAetherisModel,
  getAetherisInferenceConfig,
  resolveInferenceConfig
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

describe('resolveInferenceConfig', () => {
  it('never falls back to the Google key — it serves the website chat only', () => {
    vi.stubEnv('AETHERIS_INFERENCE_BASE_URL', '');
    vi.stubEnv('AETHERIS_INFERENCE_API_KEY', '');
    vi.stubEnv('AETHERIS_MODELS_JSON', '[]');
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'server-only-google-key');

    expect(resolveInferenceConfig().mode).toBe('none');
  });

  it('serves through the configured provider', () => {
    vi.stubEnv('AETHERIS_INFERENCE_BASE_URL', 'https://openrouter.ai/api/v1');
    vi.stubEnv('AETHERIS_INFERENCE_API_KEY', 'provider-key');
    vi.stubEnv(
      'AETHERIS_MODELS_JSON',
      JSON.stringify([
        { id: 'aetheris-basic', upstreamModel: 'vendor/model', label: 'Basic', maxTokens: 1024 }
      ])
    );
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'google-key');

    const config = resolveInferenceConfig();
    expect(config.mode).toBe('proxy');
    expect(config.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(config.apiKey).toBe('provider-key');
    expect(config.models).toHaveLength(1);
  });

  it('reports none when no provider is configured', () => {
    vi.stubEnv('AETHERIS_INFERENCE_BASE_URL', '');
    vi.stubEnv('AETHERIS_INFERENCE_API_KEY', '');
    vi.stubEnv('AETHERIS_MODELS_JSON', '[]');

    expect(resolveInferenceConfig().mode).toBe('none');
  });

  it('still fails loudly on malformed model configuration', () => {
    vi.stubEnv(
      'AETHERIS_MODELS_JSON',
      JSON.stringify([{ id: 'provider-model', upstreamModel: 'model' }])
    );
    expect(() => resolveInferenceConfig()).toThrow(
      'Aetheris model ids must start with aetheris-.'
    );
  });
});
