import { getServerSession } from 'next-auth';
import { google } from '@ai-sdk/google';
import { streamText } from 'ai';
import { authOptions } from '@/lib/auth';
import { instructionsLimit, messageCost } from '@/lib/credits';
import {
  strictIdentityFor,
  strictRefund,
  strictSpend
} from '@/lib/credit-server';
import { resolveTier } from '@/lib/pro';
import {
  PLAN_COOKIE_NAME,
  getCookieValue,
  serializePlanCookie,
  clearPlanCookieHeader
} from '@/lib/plan-cookie';
import { clientIp, limitRequest } from '@/lib/rate-limit';

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are Aetheris, a helpful, warm, direct conversational AI.

Rules:
- Respond like a thoughtful human, not a machine. Clean natural tone.
- Never include system logs, debug tags, internal reasoning, token counts, or robotic prefixes.
- Use Markdown when it helps: **bold** for emphasis, bullet/numbered lists for steps, and fenced code blocks with language tags for code.
- Keep answers focused and right-sized: short for small talk, thorough for complex questions.
- If you don't know something, say so plainly and suggest what to try next.
- When the user attaches photos, PDFs, or text files, answer from their actual content.
- Never produce sexual or explicit content, including erotica, nudes, or sexual descriptions of anyone. If asked, refuse briefly in one sentence and offer a different topic.`;

type ModelSelect = 'aetheris-basic' | 'aetheris-asteroid' | 'aetheris-pro';

function resolveGeminiModel(select: unknown): string {
  if (select === 'aetheris-pro') return 'gemini-3.8-flash';
  if (select === 'aetheris-asteroid') return 'gemini-3.5-flash-lite';
  return 'gemini-3.1-flash-lite';
}

const GEMINI_SAFETY_SETTINGS = [
  {
    category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT' as const,
    threshold: 'BLOCK_MEDIUM_AND_ABOVE' as const
  },
  {
    category: 'HARM_CATEGORY_HARASSMENT' as const,
    threshold: 'BLOCK_MEDIUM_AND_ABOVE' as const
  }
];

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
 * model content parts ({ text } + { image }) for configured multimodal models.
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

/** Health check reports Gemini chat readiness without revealing credentials. */
export async function GET() {
  return Response.json({
    provider: 'gemini',
    configured: Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY),
    models: [
    { id: 'aetheris-basic', upstream: 'gemini-3.1-flash-lite' },
    { id: 'aetheris-asteroid', upstream: 'gemini-3.5-flash-lite' },
    { id: 'aetheris-pro', upstream: 'gemini-3.8-flash' }
    ]
  });
}

export async function POST(req: Request) {
  const limited = limitRequest(req, { key: 'chat', limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  // Strict credit identity: verified session id when signed in, else IP.
  // (The body userId is ignored for metering — clients can lie about it.)
  const session = await getServerSession(authOptions).catch(() => null);
  const sessionUserId =
    session?.user?.id || session?.user?.email || null;
  let identity = strictIdentityFor(sessionUserId, clientIp(req));
  const cookieValue = getCookieValue(req.headers.get('cookie'), PLAN_COOKIE_NAME);
  let planHeader: string | null = null;
  let spent = 0;

  try {
    const body = await req.json();
    const messages = body?.messages;
    const modelSelect = body?.model as ModelSelect | undefined;

    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json({ error: 'No messages provided.' }, { status: 400 });
    }

    // Paid models require membership — resolved from the store + the
    // signed plan cookie (which survives cold starts on hosts without
    // shared storage). Verified server-side so hand-crafted requests
    // bypassing the UI can't reach paid models.
    const resolved = await resolveTier(
      sessionUserId,
      cookieValue,
      session?.user?.email ?? null
    );
    const tier = resolved.tier;
    identity = strictIdentityFor(sessionUserId, clientIp(req), tier);
    planHeader = resolved.planCookie.set
      ? serializePlanCookie(resolved.planCookie.set)
      : resolved.planCookie.clear
        ? clearPlanCookieHeader()
        : null;
    const planInit: { headers?: Record<string, string> } = planHeader
      ? { headers: { 'Set-Cookie': planHeader } }
      : {};
    if (modelSelect === 'aetheris-pro' && tier !== 'pro') {
      return Response.json(
        { error: 'Aetheris Pro is locked. Please use Aetheris Basic.' },
        { status: 403, ...planInit }
      );
    }
    if (modelSelect === 'aetheris-asteroid' && tier === 'basic') {
      return Response.json(
        { error: 'Aetheris Asteroid requires a membership. Please use Aetheris Basic.' },
        { status: 403, ...planInit }
      );
    }

    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      return Response.json(
        { error: 'Gemini chat is not configured on the server.' },
        { status: 503, ...planInit }
      );
    }
    const modelId: ModelSelect =
      modelSelect === 'aetheris-pro' || modelSelect === 'aetheris-asteroid'
        ? modelSelect
        : 'aetheris-basic';

    // Strict server-side metering (no-op unless Redis is configured).
    // Text files + PDFs arrive inlined in the message text, so the server
    // prices images from attachments; the client prices everything upfront.
    const last = messages[messages.length - 1] as Record<string, unknown>;
    const imageCount = imageUrlsFrom(last['experimental_attachments']).length;
    const cost = messageCost({
      tier: modelSelect === 'aetheris-pro' || modelSelect === 'aetheris-asteroid' ? tier : 'basic',
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
        { status: 402, ...planInit }
      );
    }
    spent = cost;

    // Personalization from the client (tier-capped length, clamped temperature).
    const rawExtra = typeof body?.systemExtra === 'string' ? body.systemExtra : '';
    const systemExtra = rawExtra.trim().slice(0, instructionsLimit(tier));
    const rawTemp = body?.temperature;
    const temperature =
      typeof rawTemp === 'number' && Number.isFinite(rawTemp)
        ? Math.min(1, Math.max(0, rawTemp))
        : 0.7;
    const system =
      systemExtra !== ''
        ? `${SYSTEM_PROMPT}\n\nUser preferences (always follow these):\n${systemExtra}`
        : SYSTEM_PROMPT;

    const modelMessages = withAttachments(messages);
    const timeout = AbortSignal.timeout(55_000);
    const abortSignal =
      req.signal && AbortSignal.any
        ? AbortSignal.any([req.signal, timeout])
        : timeout;
    const result = streamText({
      model: google(resolveGeminiModel(modelId), {
        safetySettings: GEMINI_SAFETY_SETTINGS
      }),
      system,
      messages: modelMessages,
      abortSignal,
      maxTokens: modelId === 'aetheris-basic' ? 2048 : 4096,
      temperature
    });
    return result.toDataStreamResponse(planInit);
  } catch (err) {
    // The response never streamed: refund the strict spend (if any).
    if (spent > 0) await strictRefund(identity, spent);
    console.error('[aetheris/chat] Gemini request failed:', {
      errorType: err instanceof Error ? err.name : 'UnknownError'
    });
    const message = err instanceof Error ? err.message : '';
    if (/429|rate.?limit|overload|capacity/i.test(message)) {
      return Response.json(
        {
          error: 'RATE_LIMITED',
          message: 'The AI is at capacity right now. Please retry in a few seconds.'
        },
        { status: 429 }
      );
    }
    return Response.json(
      { error: 'Aetheris AI could not complete the request. Please try again later.' },
      { status: 503 }
    );
  }
}
