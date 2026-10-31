import { generateText } from 'ai';
import {
  createAetherisLanguageModel,
  findAetherisModel,
  getAetherisInferenceConfig
} from '@/lib/aetheris-inference';
import { limitRequest } from '@/lib/rate-limit';

/**
 * Safety gate for image prompts. A static word list can't catch
 * misspellings ("neked"), slang, or euphemisms — so a fast classifier
 * judges the *intent* instead. Fail CLOSED: any doubt or outage blocks
 * generation rather than risking explicit output.
 */
export async function POST(req: Request) {
  const limited = limitRequest(req, { key: 'moderate', limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  try {
    const config = getAetherisInferenceConfig();
    const model = findAetherisModel('aetheris-basic', config);
    if (!model || !config.baseUrl || !config.apiKey) {
      return Response.json(
        { ok: false, reason: 'Aetheris safety inference is not configured yet.' },
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

    const response = await generateText({
      model: createAetherisLanguageModel(model, config),
      prompt: `You are a strict content-safety classifier for an image generator open to all ages, including minors. Does this image request ask for, describe, or imply sexual, erotic, nude, romanticized undress, or otherwise adult-only content — including misspellings, slang, euphemisms, coded language, or "implied" framings? Request: "${prompt.slice(0, 500)}". Reply with exactly one word: BLOCK or ALLOW.`,
      maxTokens: 8,
      temperature: 0
    });

    const verdict = response.text.trim().toUpperCase();
    if (verdict.startsWith('BLOCK')) {
      return Response.json({ ok: false });
    }
    if (verdict.startsWith('ALLOW')) {
      return Response.json({ ok: true });
    }
    // Unparseable verdict: fail closed.
    return Response.json({ ok: false });
  } catch (err) {
    console.error(
      '[aetheris/moderate] Aetheris inference failed:',
      err instanceof Error ? err.name : 'unknown error'
    );
    return Response.json({ ok: false, reason: 'Safety check unavailable.' });
  }
}
