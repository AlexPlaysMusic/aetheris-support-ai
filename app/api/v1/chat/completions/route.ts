import {
  findAetherisModel,
  getAetherisInferenceConfig,
  listAvailableAetherisModels
} from '@/lib/aetheris-inference';
import { recordApiKeyTokens } from '@/lib/aetheris-api-keys';
import { apiError, authorizePublicApiRequest } from '@/lib/aetheris-public-api';
import { readBoundedJson, RequestBodyTooLargeError } from '@/lib/request-body';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BODY_BYTES = 256_000;
const MAX_MESSAGES = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validMessages(value: unknown): value is Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) {
    return false;
  }
  return value.every(
    (message) =>
      isRecord(message) &&
      ['system', 'user', 'assistant'].includes(String(message['role'])) &&
      typeof message['content'] === 'string' &&
      message['content'].length <= 64_000
  );
}

function boundedNumber(
  value: unknown,
  min: number,
  max: number
): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : undefined;
}

function usageCounts(value: unknown): { prompt: number; completion: number } {
  if (!isRecord(value)) return { prompt: 0, completion: 0 };
  const prompt = value['prompt_tokens'];
  const completion = value['completion_tokens'];
  return {
    prompt: typeof prompt === 'number' && Number.isSafeInteger(prompt) ? prompt : 0,
    completion:
      typeof completion === 'number' && Number.isSafeInteger(completion)
        ? completion
        : 0
  };
}

async function saveTokenUsage(
  keyId: string,
  promptTokens: number,
  completionTokens: number
): Promise<void> {
  try {
    await recordApiKeyTokens(keyId, promptTokens, completionTokens);
  } catch (error) {
    console.error('[aetheris/public-api] token usage write failed:', error);
  }
}

export async function POST(req: Request) {
  const authorization = await authorizePublicApiRequest(req);
  if ('response' in authorization) return authorization.response;

  let body: unknown;
  try {
    body = await readBoundedJson(req, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return apiError('Request body is too large.', 413);
    }
    return apiError('Request body must be valid JSON.', 400);
  }
  if (!isRecord(body)) return apiError('Request body must be a JSON object.', 400);
  if (typeof body['model'] !== 'string' || !validMessages(body['messages'])) {
    return apiError(
      'model and a non-empty messages array with string content are required.',
      400
    );
  }
  let config;
  try {
    config = getAetherisInferenceConfig();
  } catch (error) {
    console.error('[aetheris/public-api] invalid model configuration:', error);
    return apiError('Aetheris inference is not configured correctly.', 503, 'server_error');
  }
  if (!config.baseUrl || !config.apiKey) {
    return apiError('Aetheris inference is not configured.', 503, 'server_error');
  }
  const model = findAetherisModel(body['model'], config);
  if (!model) return apiError('The requested model is not configured.', 404, 'model_not_found');

  let available: Awaited<ReturnType<typeof listAvailableAetherisModels>>;
  try {
    available = await listAvailableAetherisModels(config);
  } catch (error) {
    console.error('[aetheris/public-api] inference availability check failed:', error);
    return apiError('Aetheris inference is not available.', 503, 'server_error');
  }
  if (!available.some((active) => active.id === model.id)) {
    return apiError('The requested model is not currently available.', 503, 'server_error');
  }

  const stream = body['stream'] !== false;
  const requestedTokens =
    body['max_tokens'] ?? body['max_completion_tokens'];
  const maxTokens =
    typeof requestedTokens === 'number' && Number.isFinite(requestedTokens)
      ? Math.max(1, Math.min(model.maxTokens, Math.floor(requestedTokens)))
      : model.maxTokens;
  const upstreamBody: Record<string, unknown> = {
    model: model.upstreamModel,
    messages: body['messages'],
    stream,
    max_tokens: maxTokens
  };
  if (stream) upstreamBody['stream_options'] = { include_usage: true };
  const temperature = boundedNumber(body['temperature'], 0, 2);
  const topP = boundedNumber(body['top_p'], 0, 1);
  const presencePenalty = boundedNumber(body['presence_penalty'], -2, 2);
  const frequencyPenalty = boundedNumber(body['frequency_penalty'], -2, 2);
  if (temperature !== undefined) upstreamBody['temperature'] = temperature;
  if (topP !== undefined) upstreamBody['top_p'] = topP;
  if (presencePenalty !== undefined) upstreamBody['presence_penalty'] = presencePenalty;
  if (frequencyPenalty !== undefined) upstreamBody['frequency_penalty'] = frequencyPenalty;
  if (
    typeof body['stop'] === 'string' ||
    (Array.isArray(body['stop']) &&
      body['stop'].length <= 4 &&
      body['stop'].every((item) => typeof item === 'string'))
  ) {
    upstreamBody['stop'] = body['stop'];
  }
  if (typeof body['user'] === 'string') upstreamBody['user'] = body['user'].slice(0, 128);

  const timeout = AbortSignal.timeout(config.timeoutMs);
  const signal =
    req.signal && AbortSignal.any
      ? AbortSignal.any([req.signal, timeout])
      : timeout;
  let upstream: Response;
  try {
    upstream = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: stream ? 'text/event-stream' : 'application/json'
      },
      body: JSON.stringify(upstreamBody),
      signal
    });
  } catch (error) {
    console.error('[aetheris/public-api] inference request failed:', error);
    return apiError('Aetheris inference could not be reached.', 503, 'server_error');
  }
  if (!upstream.ok) {
    console.error('[aetheris/public-api] inference returned status:', upstream.status);
    return apiError(
      upstream.status === 429
        ? 'Aetheris inference is at capacity. Retry shortly.'
        : 'Aetheris inference could not complete the request.',
      upstream.status === 429 ? 429 : 502,
      'server_error'
    );
  }

  if (!stream) {
    let response: unknown;
    try {
      response = await upstream.json();
    } catch {
      return apiError('Aetheris inference returned an invalid response.', 502, 'server_error');
    }
    if (!isRecord(response)) {
      return apiError('Aetheris inference returned an invalid response.', 502, 'server_error');
    }
    const usage = usageCounts(response['usage']);
    await saveTokenUsage(authorization.record.id, usage.prompt, usage.completion);
    return Response.json(
      { ...response, model: model.id },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (!upstream.body) {
    return apiError('Aetheris inference returned an empty stream.', 502, 'server_error');
  }
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = '';
  let promptTokens = 0;
  let completionTokens = 0;
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '');
        if (!line.startsWith('data:')) {
          controller.enqueue(encoder.encode(`${line}\n`));
          continue;
        }
        const data = line.slice(5).trim();
        if (data === '' || data === '[DONE]') {
          controller.enqueue(encoder.encode(`${line}\n`));
          continue;
        }
        try {
          const event: unknown = JSON.parse(data);
          if (isRecord(event)) {
            const usage = usageCounts(event['usage']);
            promptTokens = usage.prompt || promptTokens;
            completionTokens = usage.completion || completionTokens;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ ...event, model: model.id })}\n`)
            );
            continue;
          }
        } catch {
          // Keep the upstream SSE payload intact if it is not JSON.
        }
        controller.enqueue(encoder.encode(`${line}\n`));
      }
    },
    async flush(controller) {
      const tail = `${pending}${decoder.decode()}`;
      if (tail !== '') controller.enqueue(encoder.encode(tail));
      await saveTokenUsage(authorization.record.id, promptTokens, completionTokens);
    }
  });
  return new Response(upstream.body.pipeThrough(transform), {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
}
