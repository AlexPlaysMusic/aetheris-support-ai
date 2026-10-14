import { GoogleGenAI } from '@google/genai';

/**
 * Safety gate for image prompts. A static word list can't catch
 * misspellings ("neked"), slang, or euphemisms — so a fast classifier
 * judges the *intent* instead. Fail CLOSED: any doubt or outage blocks
 * generation rather than risking explicit output.
 */
export async function POST(req: Request) {
  try {
    const apiKey =
      process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '';
    if (apiKey === '') {
      return Response.json(
        { ok: false, reason: 'Safety check is not configured yet.' },
        { status: 503 }
      );
    }

    const body: unknown = await req.json();
    const record =
      body !== null && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : {};
    const prompt =
      typeof record['prompt'] === 'string' ? record['prompt'].trim() : '';
    if (prompt === '' || prompt.length > 1000) {
      return Response.json({ ok: false, reason: 'Empty prompt.' });
    }

    const model = process.env.GEMINI_BASIC_MODEL ?? 'gemini-3.1-flash-lite';
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `You are a strict content-safety classifier for an image generator open to all ages, including minors. Does this image request ask for, describe, or imply sexual, erotic, nude, romanticized undress, or otherwise adult-only content — including misspellings, slang, euphemisms, coded language, or "implied" framings? Request: "${prompt.slice(0, 500)}". Reply with exactly one word: BLOCK or ALLOW.`
            }
          ]
        }
      ]
    });

    const verdict = (response.text ?? '').trim().toUpperCase();
    if (verdict.startsWith('BLOCK')) {
      return Response.json({ ok: false });
    }
    if (verdict.startsWith('ALLOW')) {
      return Response.json({ ok: true });
    }
    // Unparseable verdict: fail closed.
    return Response.json({ ok: false });
  } catch (err) {
    console.error('[aetheris/moderate] error:', err);
    return Response.json({ ok: false, reason: 'Safety check unavailable.' });
  }
}
