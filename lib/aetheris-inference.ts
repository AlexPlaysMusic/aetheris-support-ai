import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV1 } from '@ai-sdk/provider';

export type AetherisModel = {
  id: string;
  upstreamModel: string;
  label: string;
  maxTokens: number;
  supportsVision: boolean;
};

export type AetherisInferenceConfig = {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  models: AetherisModel[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function getAetherisInferenceConfig(): AetherisInferenceConfig {
  const rawModels = process.env.AETHERIS_MODELS_JSON?.trim() ?? '';
  let parsedModels: unknown = [];
  if (rawModels !== '') {
    try {
      parsedModels = JSON.parse(rawModels);
    } catch {
      throw new Error('AETHERIS_MODELS_JSON must be valid JSON.');
    }
    if (!Array.isArray(parsedModels)) {
      throw new Error('AETHERIS_MODELS_JSON must be a JSON array.');
    }
  }

  const modelEntries = Array.isArray(parsedModels) ? parsedModels : [];
  const models: AetherisModel[] = [];
  const ids = new Set<string>();
  for (const value of modelEntries) {
    if (!isRecord(value)) throw new Error('Each Aetheris model must be an object.');
    const id = typeof value['id'] === 'string' ? value['id'].trim() : '';
    const upstreamModel =
      typeof value['upstreamModel'] === 'string'
        ? value['upstreamModel'].trim()
        : '';
    const label =
      typeof value['label'] === 'string' && value['label'].trim() !== ''
        ? value['label'].trim().slice(0, 80)
        : id;
    const maxTokensRaw = value['maxTokens'];
    const maxTokens =
      typeof maxTokensRaw === 'number' && Number.isFinite(maxTokensRaw)
        ? Math.floor(maxTokensRaw)
        : 2048;
    if (!/^aetheris-[a-z0-9][a-z0-9._-]{0,62}$/.test(id)) {
      throw new Error('Aetheris model ids must start with aetheris-.');
    }
    if (ids.has(id)) throw new Error(`Duplicate Aetheris model id: ${id}`);
    if (upstreamModel === '' || upstreamModel.length > 200) {
      throw new Error(`Aetheris model ${id} needs an upstreamModel value.`);
    }
    if (maxTokens < 1 || maxTokens > 32768) {
      throw new Error(`Aetheris model ${id} maxTokens must be between 1 and 32768.`);
    }
    ids.add(id);
    models.push({
      id,
      upstreamModel,
      label,
      maxTokens,
      supportsVision: value['supportsVision'] === true
    });
  }

  const baseUrl = (process.env.AETHERIS_INFERENCE_BASE_URL ?? '')
    .trim()
    .replace(/\/+$/, '');
  const apiKey = (process.env.AETHERIS_INFERENCE_API_KEY ?? '').trim();
  const timeoutRaw = Number(process.env.AETHERIS_INFERENCE_TIMEOUT_MS ?? 120000);
  const timeoutMs =
    Number.isFinite(timeoutRaw) && timeoutRaw >= 1000 && timeoutRaw <= 300000
      ? Math.floor(timeoutRaw)
      : 120000;

  if (baseUrl !== '') {
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new Error('AETHERIS_INFERENCE_BASE_URL must be an absolute URL.');
    }
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
      throw new Error('Aetheris inference must use HTTPS outside localhost.');
    }
  }

  return { baseUrl, apiKey, timeoutMs, models };
}

export function findAetherisModel(
  modelId: string,
  config: AetherisInferenceConfig = getAetherisInferenceConfig()
): AetherisModel | null {
  return config.models.find((model) => model.id === modelId) ?? null;
}

export function createAetherisLanguageModel(
  model: AetherisModel,
  config: AetherisInferenceConfig = getAetherisInferenceConfig()
): LanguageModelV1 {
  if (!config.baseUrl || !config.apiKey) {
    throw new Error('Aetheris inference is not configured.');
  }
  const provider = createOpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    fetch: async (input, init) => {
      const timeout = AbortSignal.timeout(config.timeoutMs);
      const signal =
        init?.signal && AbortSignal.any
          ? AbortSignal.any([init.signal, timeout])
          : timeout;
      return fetch(input, { ...init, signal });
    }
  });
  return provider(model.upstreamModel);
}

export async function listAvailableAetherisModels(
  config: AetherisInferenceConfig = getAetherisInferenceConfig()
): Promise<AetherisModel[]> {
  if (!config.baseUrl || !config.apiKey || config.models.length === 0) return [];
  const response = await fetch(`${config.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(Math.min(config.timeoutMs, 8000)),
    cache: 'no-store'
  });
  if (!response.ok) {
    throw new Error(`Aetheris inference model check failed (${response.status}).`);
  }
  const body: unknown = await response.json();
  const data = isRecord(body) ? body['data'] : null;
  if (!Array.isArray(data)) {
    throw new Error('Aetheris inference returned an invalid models response.');
  }
  const loadedIds = new Set(
    data.flatMap((item) =>
      isRecord(item) && typeof item['id'] === 'string' ? [item['id']] : []
    )
  );
  return config.models.filter((model) => loadedIds.has(model.upstreamModel));
}

/** Google's OpenAI-compatible endpoint — used as the relay when no
 *  Aetheris inference host is configured. The Google key stays server-side. */
export const GEMINI_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

/** The three Aetheris aliases served through the Gemini relay. Kept in step
 *  with the website's chat route (gemini-3.1/3.5/3.8 mapping). */
const GEMINI_RELAY_MODELS: AetherisModel[] = [
  {
    id: 'aetheris-basic',
    upstreamModel: 'gemini-3.1-flash-lite',
    label: 'Aetheris Basic',
    maxTokens: 2048,
    supportsVision: false
  },
  {
    id: 'aetheris-asteroid',
    upstreamModel: 'gemini-3.5-flash-lite',
    label: 'Aetheris Asteroid',
    maxTokens: 4096,
    supportsVision: false
  },
  {
    id: 'aetheris-pro',
    upstreamModel: 'gemini-3.8-flash',
    label: 'Aetheris Pro',
    maxTokens: 4096,
    supportsVision: true
  }
];

export type ResolvedInferenceConfig = AetherisInferenceConfig & {
  /** proxy: configured OpenAI-compatible host · gemini: built-in relay · none: unconfigured */
  mode: 'proxy' | 'gemini' | 'none';
};

/**
 * Inference configuration with a working default: a configured host wins,
 * otherwise the server's Gemini key serves the Aetheris aliases through
 * Google's OpenAI-compatible endpoint, so the developer API works with zero
 * additional environment setup. Throws only for genuinely invalid config
 * (malformed AETHERIS_MODELS_JSON / non-HTTPS host) — that stays loud.
 */
export function resolveInferenceConfig(): ResolvedInferenceConfig {
  const env = getAetherisInferenceConfig();
  if (env.baseUrl !== '' && env.apiKey !== '') {
    return { ...env, mode: 'proxy' };
  }
  const googleKey = (process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '').trim();
  if (googleKey !== '') {
    return {
      baseUrl: GEMINI_OPENAI_BASE_URL,
      apiKey: googleKey,
      timeoutMs: env.timeoutMs,
      models: GEMINI_RELAY_MODELS,
      mode: 'gemini'
    };
  }
  return { ...env, mode: 'none' };
}
