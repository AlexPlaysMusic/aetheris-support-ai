import type {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1Prompt,
  LanguageModelV1StreamPart
} from '@ai-sdk/provider';

/* ------------------------------------------------------------------ */
/* Config — all values come from env so you can swap LLMs without      */
/* touching code. See .env.local.example for documentation.            */
/* ------------------------------------------------------------------ */

export type AetherisModelSelect = 'aetheris-basic' | 'aetheris-pro';

export type CustomLlmConfig = {
  baseUrl: string;
  apiKey: string;
  authHeaderName: string;
  authScheme: string;
  basicModel: string;
  proModel: string;
  timeoutMs: number;
  extraParams: Record<string, unknown>;
};

export function getCustomConfig(): CustomLlmConfig {
  let extraParams: Record<string, unknown> = {};
  const rawExtra = process.env.CUSTOM_API_EXTRA_PARAMS?.trim();
  if (rawExtra) {
    try {
      const parsed: unknown = JSON.parse(rawExtra);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        extraParams = parsed as Record<string, unknown>;
      }
    } catch {
      console.warn('[aetheris] CUSTOM_API_EXTRA_PARAMS is not valid JSON — ignoring.');
    }
  }

  const timeoutRaw = Number(process.env.CUSTOM_API_TIMEOUT_MS ?? 60000);

  return {
    baseUrl: (process.env.CUSTOM_API_URL ?? '').trim().replace(/\/+$/, ''),
    apiKey: (process.env.CUSTOM_API_KEY ?? '').trim(),
    authHeaderName: (process.env.CUSTOM_API_AUTH_HEADER ?? 'Authorization').trim() || 'Authorization',
    authScheme: (process.env.CUSTOM_API_AUTH_SCHEME ?? 'Bearer').trim(),
    basicModel: (process.env.CUSTOM_BASIC_MODEL ?? 'aetheris-basic-v1').trim() || 'aetheris-basic-v1',
    proModel: (process.env.CUSTOM_PRO_MODEL ?? 'aetheris-pro-v1').trim() || 'aetheris-pro-v1',
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 60000,
    extraParams
  };
}

export function resolveCustomModelId(
  select: unknown,
  cfg: CustomLlmConfig
): string {
  return select === 'aetheris-pro' ? cfg.proModel : cfg.basicModel;
}

/* ------------------------------------------------------------------ */
/* Adaptation points.                                                  */
/*                                                                     */
/*  1. buildCustomPayload — shape of the POST body sent to YOUR api.    */
/*     Default is OpenAI-chat style ({ model, messages, stream, ... }) */
/*     which most servers (vLLM, LM Studio, Together, LiteLLM, custom  */
/*     gateways) accept. Edit here if your API expects other fields.    */
/*                                                                     */
/*  2. extractDeltaText / extractFullText — where reply text lives in   */
/*     YOUR api's responses (SSE events and JSON bodies). Add your      */
/*     field names to the candidate lists below.                       */
/* ------------------------------------------------------------------ */

type SimpleMessage = { role: string; content: string };

function partToText(part: unknown): string {
  const p = asRecord(part);
  if (!p) return '';
  if (p['type'] === 'text' && typeof p['text'] === 'string') return p['text'];
  if (p['type'] === 'image') return '[image]';
  if (p['type'] === 'file') {
    const mt = typeof p['mimeType'] === 'string' ? p['mimeType'] : 'file';
    return `[file: ${mt}]`;
  }
  if (p['type'] === 'tool-call') {
    const name = typeof p['toolName'] === 'string' ? p['toolName'] : 'tool';
    return `[tool call: ${name}]`;
  }
  if (p['type'] === 'tool-result') return '[tool result]';
  if (typeof p['text'] === 'string') return p['text'];
  return '';
}

/** Flatten the AI SDK prompt into plain { role, content } messages. */
function promptToSimpleMessages(prompt: LanguageModelV1Prompt): SimpleMessage[] {
  return prompt.map((message) => {
    const record = asRecord(message) ?? {};
    const role = typeof record['role'] === 'string' ? record['role'] : 'user';
    const content = record['content'];
    const text = Array.isArray(content)
      ? content.map(partToText).filter(Boolean).join('')
      : typeof content === 'string'
        ? content
        : '';
    // Most custom servers don't know the "tool" role — deliver as user text.
    return { role: role === 'tool' ? 'user' : role, content: text };
  });
}

/* -- ADAPTATION POINT 1 -------------------------------------------- */
function buildCustomPayload(args: {
  modelId: string;
  prompt: LanguageModelV1Prompt;
  temperature?: number;
  maxTokens?: number;
  stream: boolean;
  extraParams: Record<string, unknown>;
}): Record<string, unknown> {
  const messages = promptToSimpleMessages(args.prompt);
  return {
    model: args.modelId,
    messages,
    stream: args.stream,
    ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
    ...(args.maxTokens !== undefined ? { max_tokens: args.maxTokens } : {}),
    ...args.extraParams
  };
}

/* -- small unknown-safe helpers (no `any`) -------------------------- */

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function firstChoice(json: unknown): Record<string, unknown> | null {
  const root = asRecord(json);
  if (!root) return null;
  const choices = root['choices'];
  if (Array.isArray(choices) && choices.length > 0) {
    return asRecord(choices[0]);
  }
  return null;
}

/** Pull a streaming text delta out of one SSE event payload. */
function extractDeltaText(event: unknown): string {
  if (typeof event === 'string') return event;
  const record = asRecord(event);
  if (!record) return '';

  const choice = firstChoice(event);
  if (choice) {
    const delta = asRecord(choice['delta']);
    if (delta) {
      if (typeof delta['content'] === 'string') return delta['content'];
      if (typeof delta['text'] === 'string') return delta['text'];
    }
    if (typeof choice['text'] === 'string') return choice['text'];
    const msg = asRecord(choice['message']);
    if (msg && typeof msg['content'] === 'string') return msg['content'];
  }

  const candidates = [
    'delta',
    'content',
    'text',
    'token',
    'output_text',
    'output',
    'response',
    'completion',
    'generated_text',
    'message'
  ];
  for (const key of candidates) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '';
}

/** Pull the full reply text out of a non-streaming JSON body. */
function extractFullText(json: unknown): string {
  if (typeof json === 'string') return json;
  const delta = extractDeltaText(json);
  if (delta) return delta;
  const record = asRecord(json);
  if (!record) return '';
  for (const key of ['data', 'result', 'reply']) {
    const nested = record[key];
    if (nested !== undefined) {
      const text = extractDeltaText(nested);
      if (text) return text;
    }
  }
  return '';
}

/* -- http ----------------------------------------------------------- */

function buildHeaders(cfg: CustomLlmConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) {
    const value = cfg.authScheme ? `${cfg.authScheme} ${cfg.apiKey}` : cfg.apiKey;
    headers[cfg.authHeaderName] = value;
  }
  return headers;
}

function timeoutSignal(ms: number, parent?: AbortSignal | null): AbortSignal | undefined {
  if (!ms || ms <= 0) return parent ?? undefined;
  try {
    const timer = AbortSignal.timeout(ms);
    if (parent) return AbortSignal.any([parent, timer]);
    return timer;
  } catch {
    return parent ?? undefined;
  }
}

async function postToCustomApi(args: {
  cfg: CustomLlmConfig;
  modelId: string;
  options: LanguageModelV1CallOptions;
  stream: boolean;
}): Promise<Response> {
  const payload = buildCustomPayload({
    modelId: args.modelId,
    prompt: args.options.prompt,
    temperature: args.options.temperature,
    maxTokens: args.options.maxTokens,
    stream: args.stream,
    extraParams: args.cfg.extraParams
  });

  const extraHeaders = (args.options.headers ?? {}) as Record<string, string | undefined>;
  const headers: Record<string, string> = { ...buildHeaders(args.cfg) };
  for (const [key, value] of Object.entries(extraHeaders)) {
    if (value !== undefined) headers[key] = value;
  }

  let res: Response;
  try {
    res = await fetch(args.cfg.baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: timeoutSignal(args.cfg.timeoutMs, args.options.abortSignal ?? null)
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error(
        `Custom LLM request timed out after ${args.cfg.timeoutMs}ms (${args.cfg.baseUrl}).`
      );
    }
    throw err instanceof Error ? err : new Error('Failed to reach the custom LLM API.');
  }

  if (!res.ok) {
    const snippet = (await res.text().catch(() => '')).slice(0, 500);
    throw new Error(
      `Custom LLM API error ${res.status} ${res.statusText}${snippet ? ` — ${snippet}` : ''}`
    );
  }
  return res;
}

/* -- the provider: plugs any custom REST api into streamText --------- */

export function createCustomChatModel(
  modelId: string,
  cfg: CustomLlmConfig
): LanguageModelV1 {
  const readStreamAsSse = async (
    res: Response,
    controller: ReadableStreamDefaultController<LanguageModelV1StreamPart>
  ): Promise<void> => {
    const reader = res.body?.getReader();
    if (!reader) {
      const text = await res.text();
      const full = extractFullText(safeJsonParse(text) ?? text);
      if (full) controller.enqueue({ type: 'text-delta', textDelta: full });
      controller.enqueue({
        type: 'finish',
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0 }
      });
      controller.close();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    const flushEvents = (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '').trim();
        if (!line || line.startsWith(':') || line.startsWith('event:')) continue;
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        const delta = extractDeltaText(safeJsonParse(data) ?? data);
        if (delta) controller.enqueue({ type: 'text-delta', textDelta: delta });
      }
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        flushEvents(decoder.decode(value, { stream: true }));
      }
      flushEvents(decoder.decode());
      if (buffer.trim()) {
        const tail = buffer.trim().replace(/^data:\s*/, '');
        if (tail && tail !== '[DONE]') {
          const delta = extractDeltaText(safeJsonParse(tail) ?? tail);
          if (delta) controller.enqueue({ type: 'text-delta', textDelta: delta });
        }
      }
      controller.enqueue({
        type: 'finish',
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0 }
      });
      controller.close();
    } catch (err) {
      controller.enqueue({
        type: 'error',
        error: err instanceof Error ? err : new Error('Custom stream failed.')
      });
      controller.close();
    } finally {
      reader.releaseLock();
    }
  };

  return {
    specificationVersion: 'v1',
    provider: 'custom',
    modelId,
    defaultObjectGenerationMode: undefined,

    async doGenerate(options: LanguageModelV1CallOptions) {
      const res = await postToCustomApi({ cfg, modelId, options, stream: false });
      const contentType = res.headers.get('content-type') ?? '';
      let text = '';
      if (contentType.includes('text/event-stream')) {
        const raw = await res.text();
        const deltas: string[] = [];
        for (const rawLine of raw.split('\n')) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          const delta = extractDeltaText(safeJsonParse(data) ?? data);
          if (delta) deltas.push(delta);
        }
        text = deltas.join('');
      } else if (contentType.includes('application/json')) {
        text = extractFullText(await res.json().catch(() => ({})));
      } else {
        const raw = await res.text();
        text = extractFullText(safeJsonParse(raw) ?? raw);
      }

      return {
        text,
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0 },
        rawCall: { rawPrompt: options.prompt, rawSettings: {} as Record<string, unknown> }
      };
    },

    async doStream(options: LanguageModelV1CallOptions) {
      const res = await postToCustomApi({ cfg, modelId, options, stream: true });
      const contentType = (res.headers.get('content-type') ?? '').toLowerCase();

      // Non-SSE backends: emit the whole reply as deltas, still streams to UI.
      if (!contentType.includes('text/event-stream')) {
        const stream = new ReadableStream<LanguageModelV1StreamPart>({
          async start(controller) {
            try {
              let text: string;
              if (contentType.includes('application/json')) {
                text = extractFullText(await res.json().catch(() => ({})));
              } else {
                const raw = await res.text();
                text = extractFullText(safeJsonParse(raw) ?? raw);
              }
              // Emit in slices so the UI paints progressively.
              const SIZE = 60;
              for (let i = 0; i < text.length; i += SIZE) {
                controller.enqueue({
                  type: 'text-delta',
                  textDelta: text.slice(i, i + SIZE)
                });
              }
              controller.enqueue({
                type: 'finish',
                finishReason: 'stop',
                usage: { promptTokens: 0, completionTokens: 0 }
              });
              controller.close();
            } catch (err) {
              controller.enqueue({
                type: 'error',
                error: err instanceof Error ? err : new Error('Custom stream failed.')
              });
              controller.close();
            }
          }
        });
        return {
          stream,
          rawCall: { rawPrompt: options.prompt, rawSettings: {} as Record<string, unknown> }
        };
      }

      const stream = new ReadableStream<LanguageModelV1StreamPart>({
        async start(controller) {
          await readStreamAsSse(res, controller);
        },
        cancel() {
          // The fetch abortSignal (wired from useChat stop button) handles cancel.
        }
      });
      return {
        stream,
        rawCall: { rawPrompt: options.prompt, rawSettings: {} as Record<string, unknown> }
      };
    }
  };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
