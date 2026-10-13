import { GoogleGenAI } from '@google/genai';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { CREDIT_COST_IMAGE_GEN } from '@/lib/credits';
import {
  strictIdentityFor,
  strictRefund,
  strictSpend
} from '@/lib/credit-server';

/** Ask Gemini for one image and return it as a PNG data URL. */
async function generateImageDataUrl(
  apiKey: string,
  model: string,
  prompt: string
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      responseModalities: ['TEXT', 'IMAGE']
    }
  });
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inline = (part as { inlineData?: { data?: unknown; mimeType?: unknown } })
      .inlineData;
    if (inline && typeof inline.data === 'string' && inline.data !== '') {
      const mime =
        typeof inline.mimeType === 'string' && inline.mimeType.startsWith('image/')
          ? (inline.mimeType as string)
          : 'image/png';
      return `data:${mime};base64,${inline.data}`;
    }
  }
  // Model answered in words instead of pixels — surface that text.
  const fallback = response.text?.trim() ?? '';
  throw new Error(
    fallback !== ''
      ? `The image model replied in words: "${fallback.slice(0, 200)}"`
      : 'The image model returned no image. Try a different prompt.'
  );
}

export const maxDuration = 60;

export async function POST(req: Request) {
  const apiKey =
    process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '';
  if (apiKey === '') {
    return Response.json(
      { error: 'Image generation is not configured yet.' },
      { status: 503 }
    );
  }

  const session = await getServerSession(authOptions).catch(() => null);
  const sessionUserId = session?.user?.id || session?.user?.email || null;
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || null;
  const identity = strictIdentityFor(sessionUserId, ip);
  let spent = 0;

  try {
    const body: unknown = await req.json();
    const record =
      body !== null && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : {};
    const prompt =
      typeof record['prompt'] === 'string' ? record['prompt'].trim() : '';
    if (prompt === '' || prompt.length > 1000) {
      return Response.json(
        { error: 'Describe the image in a few words (max 1000 characters).' },
        { status: 400 }
      );
    }

    const wallet = await strictSpend(identity, CREDIT_COST_IMAGE_GEN);
    if (!wallet.ok) {
      return Response.json(
        {
          error: 'OUT_OF_CREDITS',
          message: 'Not enough credits for image generation — it costs 10.'
        },
        { status: 402 }
      );
    }
    spent = CREDIT_COST_IMAGE_GEN;

    const model = process.env.IMAGE_GEN_MODEL ?? 'gemini-2.5-flash-image';
    const image = await generateImageDataUrl(apiKey, model, prompt);
    return Response.json({ ok: true, image });
  } catch (err) {
    if (spent > 0) await strictRefund(identity, spent);
    console.error('[aetheris/image] error:', err);
    const raw = err instanceof Error ? err.message : 'Image generation failed.';
    // Quota/billing rejections get a plain-English message instead of API jargon.
    if (/quota|429|RESOURCE_EXHAUSTED|exceed|billing/i.test(raw)) {
      return Response.json(
        {
          error:
            'Image generation isn’t available on the current API plan yet — text chat is unaffected.'
        },
        { status: 429 }
      );
    }
    return Response.json({ error: raw }, { status: 500 });
  }
}
