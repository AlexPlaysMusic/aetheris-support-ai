import { getServerSession } from 'next-auth';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { authOptions } from '@/lib/auth';
import {
  createCustomChatModel,
  getCustomConfig,
  resolveCustomModelId
} from '@/lib/custom-llm';
import { createDemoChatModel } from '@/lib/demo-llm';
import { messageCost } from '@/lib/credits';
import {
  strictIdentityFor,
  strictRefund,
  strictSpend
} from '@/lib/credit-server';

export const maxDuration = 30;

const SYSTEM_PROMPT = `You are Aetheris, a helpful, warm, direct conversational AI.

Rules:
- Respond like a thoughtful human, not a machine. Clean natural tone.
- Never include system logs, debug tags, internal reasoning, token counts, or robotic prefixes.
- Use Markdown when it helps: **bold** for emphasis, bullet/numbered lists for steps, and fenced code blocks with language tags for code.
- Keep answers focused and right-sized: short for small talk, thorough for complex questions.
- If you don't know something, say so plainly and suggest what to try next.
- When the user attaches photos, PDFs, or text files, answer from their actual content.`;

type ModelSelect = 'aetheris-basic' | 'aetheris-pro';

function resolveOpenAiModel(select: unknown): 'gpt-4o-mini' | 'gpt-4o' {
  if (select === 'aetheris-pro') return 'gpt-4o';
  return 'gpt-4o-mini';
}

function resolveDemoModel(select: unknown): string {
  return select === 'aetheris-pro' ? 'aetheris-pro-demo' : 'aetheris-basic-demo';
}

function resolveGeminiModel(select: unknown): string {
  if (select === 'aetheris-pro') {
    return (process.env.GEMINI_PRO_MODEL ?? 'gemini-3.8-flash').trim() || 'gemini-3.8-flash';
  }
  return (process.env.GEMINI_BASIC_MODEL ?? 'gemini-3.1-flash-lite').trim() || 'gemini-3.1-flash-lite';
}

/**
 * Photo data URLs from a message's experimental_attachments.
 * NOTE: this SDK version rejects `file` parts in user messages, so PDFs
 * and text files arrive already inlined as message text (see the client).
 */
function imageUrlsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const urls: string[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    if (typeof a['url'] !== 'string') continue;
    const ct = typeof a['contentType'] === 'string' ? a['contentType'] : '';
    const url = a['url'];
    if (ct.startsWith('image/') || url.startsWith('data:image')) urls.push(url);
  }
  return urls;
}

/**
 * Fold the last user message's experimental_attachments into standard
 * model content parts ({ text } + { image }) so every provider —
 * Gemini, OpenAI, custom — receives the actual photos.
 */
function withAttachments(messages: any): any {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const last = messages[messages.length - 1] as Record<string, unknown>;
  if (last['role'] !== 'user') return messages;
  const urls = imageUrlsFrom(last['experimental_attachments']);
  if (urls.length === 0) return messages;
  const text = typeof last['content'] === 'string' ? last['content'] : '';
  return [
    ...messages.slice(0, -1),
    {
      role: 'user',
      content: [
        { type: 'text', text },
        ...urls.map((url) => ({ type: 'image', image: url }))
      ]
    }
  ];
}

/** Health check: GET /api/chat shows which provider is wired (no secrets). */
export async function GET() {
  const provider = (process.env.LLM_PROVIDER ?? 'demo').toLowerCase();
  if (provider === 'openai') {
    return Response.json({
      provider: 'openai',
      basicModel: 'gpt-4o-mini',
      proModel: 'gpt-4o',
      hasKey: Boolean(process.env.OPENAI_API_KEY)
    });
  }
  if (provider === 'demo') {
    return Response.json({
      provider: 'demo',
      basicModel: 'aetheris-basic-demo',
      proModel: 'aetheris-pro-demo',
      note: 'Built-in demo stream. Set LLM_PROVIDER=gemini + GOOGLE_GENERATIVE_AI_API_KEY for real AI.'
    });
  }
  if (provider === 'gemini') {
    return Response.json({
      provider: 'gemini',
      basicModel: (process.env.GEMINI_BASIC_MODEL ?? 'gemini-3.1-flash-lite').trim(),
      proModel: (process.env.GEMINI_PRO_MODEL ?? 'gemini-3.8-flash').trim(),
      hasKey: Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY)
    });
  }
  const cfg = getCustomConfig();
  return Response.json({
    provider: 'custom',
    urlConfigured: Boolean(cfg.baseUrl),
    basicModel: cfg.basicModel,
    proModel: cfg.proModel,
    hasKey: Boolean(cfg.apiKey)
  });
}

function clientIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim();
  return ip && ip !== '' ? ip : null;
}

export async function POST(req: Request) {
  // Strict credit identity: verified session id when signed in, else IP.
  // (The body userId is ignored for metering — clients can lie about it.)
  const session = await getServerSession(authOptions).catch(() => null);
  const sessionUserId =
    session?.user?.id || session?.user?.email || null;
  const identity = strictIdentityFor(sessionUserId, clientIp(req));
  let spent = 0;

  try {
    const body = await req.json();
    const messages = body?.messages;
    const modelSelect = body?.model as ModelSelect | undefined;

    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json({ error: 'No messages provided.' }, { status: 400 });
    }

    // Aetheris Pro is locked — reject it server-side so it can't be
    // reached by hand-crafted requests bypassing the UI.
    if (modelSelect === 'aetheris-pro') {
      return Response.json(
        { error: 'Aetheris Pro is locked. Please use Aetheris Basic.' },
        { status: 403 }
      );
    }

    // Strict server-side metering (no-op unless Redis is configured).
    // Text files + PDFs arrive inlined in the message text, so the server
    // prices images from attachments; the client prices everything upfront.
    const last = messages[messages.length - 1] as Record<string, unknown>;
    const imageCount = imageUrlsFrom(last['experimental_attachments']).length;
    const cost = messageCost({
      pro: false,
      images: imageCount,
      files: 0
    });
    const wallet = await strictSpend(identity, cost);
    if (!wallet.ok) {
      return Response.json(
        {
          error: 'OUT_OF_CREDITS',
          message:
            identity.kind === 'guest'
              ? 'Out of free credits for today — sign in for 100 a day.'
              : 'Out of credits for today — more land at midnight.'
        },
        { status: 402 }
      );
    }
    spent = cost;

    const provider = (process.env.LLM_PROVIDER ?? 'demo').toLowerCase();
    const modelMessages = withAttachments(messages);

    // ---- Built-in demo stream (default: works with zero config) ----
    if (provider === 'demo') {
      const result = streamText({
        model: createDemoChatModel(resolveDemoModel(modelSelect)),
        system: SYSTEM_PROMPT,
        messages: modelMessages,
        temperature: 0.7
      });
      return result.toDataStreamResponse();
    }

    // ---- Google Gemini (LLM_PROVIDER=gemini, free tier, no credit card) ----
    if (provider === 'gemini') {
      if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
        return Response.json(
          {
            error:
              'Missing GOOGLE_GENERATIVE_AI_API_KEY. Paste your free key from Google AI Studio into .env.local and restart the dev server.'
          },
          { status: 500 }
        );
      }
      const result = streamText({
        model: google(resolveGeminiModel(modelSelect)),
        system: SYSTEM_PROMPT,
        messages: modelMessages,
        temperature: 0.7
      });
      return result.toDataStreamResponse();
    }

    // ---- OpenAI fallback (LLM_PROVIDER=openai) ----
    if (provider === 'openai') {
      if (!process.env.OPENAI_API_KEY) {
        return Response.json(
          {
            error:
              'Missing OPENAI_API_KEY. Add it to .env.local and restart the dev server.'
          },
          { status: 500 }
        );
      }
      const result = streamText({
        model: openai(resolveOpenAiModel(modelSelect)),
        system: SYSTEM_PROMPT,
        messages: modelMessages,
        temperature: 0.7
      });
      return result.toDataStreamResponse();
    }

    // ---- Custom REST LLM (LLM_PROVIDER=custom) ----
    const cfg = getCustomConfig();
    if (!cfg.baseUrl) {
      return Response.json(
        {
          error:
            'Missing CUSTOM_API_URL. Set it in .env.local to your LLM endpoint (or set LLM_PROVIDER=demo for the built-in stream).'
        },
        { status: 500 }
      );
    }

    const target = resolveCustomModelId(modelSelect, cfg);
    const result = streamText({
      model: createCustomChatModel(target, cfg),
      system: SYSTEM_PROMPT,
      messages: modelMessages,
      temperature: 0.7
    });
    return result.toDataStreamResponse();
  } catch (err) {
    // The response never streamed: refund the strict spend (if any).
    if (spent > 0) await strictRefund(identity, spent);
    console.error('[aetheris/chat] error:', err);
    const message =
      err instanceof Error ? err.message : 'Failed to generate a response.';
    return Response.json(
      { error: `LLM request failed: ${message}` },
      { status: 500 }
    );
  }
}
