import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  findAetherisModel,
  getAetherisInferenceConfig,
  GEMINI_OPENAI_BASE_URL,
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
  it('falls back to the Gemini relay when no host is configured', () => {
    vi.stubEnv('AETHERIS_INFERENCE_BASE_URL', '');
    vi.stubEnv('AETHERIS_INFERENCE_API_KEY', '');
    vi.stubEnv('AETHERIS_MODELS_JSON', '[]');
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'server-only-google-key');

    const config = resolveInferenceConfig();
    expect(config.mode).toBe('gemini');
    expect(config.baseUrl).toBe(GEMINI_OPENAI_BASE_URL);
    expect(config.apiKey).toBe('server-only-google-key');
    expect(config.models.map((model) => model.id)).toEqual([
      'aetheris-basic',
      'aetheris-asteroid',
      'aetheris-pro'
    ]);
    expect(findAetherisModel('aetheris-pro', config)?.upstreamModel).toBe(
      'gemini-3.8-flash'
    );
  });

  it('prefers a configured host over the relay', () => {
    vi.stubEnv('AETHERIS_INFERENCE_BASE_URL', 'https://inference.example.com/v1');
    vi.stubEnv('AETHERIS_INFERENCE_API_KEY', 'host-key');
    vi.stubEnv(
      'AETHERIS_MODELS_JSON',
      JSON.stringify([
        { id: 'aetheris-basic', upstreamModel: 'host/model', label: 'Basic', maxTokens: 1024 }
      ])
    );
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'google-key');

    const config = resolveInferenceConfig();
    expect(config.mode).toBe('proxy');
    expect(config.baseUrl).toBe('https://inference.example.com/v1');
    expect(config.models).toHaveLength(1);
  });

  it('reports none when neither a host nor a Google key exists', () => {
    vi.stubEnv('AETHERIS_INFERENCE_BASE_URL', '');
    vi.stubEnv('AETHERIS_INFERENCE_API_KEY', '');
    vi.stubEnv('AETHERIS_MODELS_JSON', '[]');
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', '');

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
