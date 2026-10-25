import { limitRequest } from '@/lib/rate-limit';

export async function POST(req: Request) {
  const limited = limitRequest(req, { key: 'verify', limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { claim?: unknown; sourceUrl?: unknown } | null;
  const claim = typeof body?.claim === 'string' ? body.claim.trim().slice(0, 500) : '';
  const sourceUrl = typeof body?.sourceUrl === 'string' ? body.sourceUrl.trim() : '';
  if (!claim) return Response.json({ error: 'Enter a claim to verify.' }, { status: 400 });

  if (!sourceUrl) {
    return Response.json({
      status: 'needs-source',
      confidence: 'low',
      explanation: 'No source was supplied. Run live research first, then verify the claim against a specific result.'
    });
  }
  try {
    const parsedUrl = new URL(sourceUrl);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return Response.json({ error: 'Source URL must use HTTP or HTTPS.' }, { status: 400 });
    }
    const hostname = parsedUrl.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.endsWith('.local') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.')
    ) {
      return Response.json({ error: 'Private network sources cannot be checked.' }, { status: 400 });
    }
    const response = await fetch(sourceUrl, {
      headers: { 'User-Agent': 'AetherisVerifier/1.0' },
      signal: AbortSignal.timeout(8000)
    });
    const text = (await response.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
    const words = claim.toLowerCase().split(/\W+/).filter((word) => word.length > 3);
    const matches = words.filter((word) => text.includes(word)).length;
    const ratio = words.length === 0 ? 0 : matches / words.length;
    return Response.json({
      status: ratio >= 0.65 ? 'supported' : ratio >= 0.35 ? 'partially-supported' : 'not-found',
      confidence: ratio >= 0.65 ? 'medium' : 'low',
      matchedTerms: matches,
      checkedAt: new Date().toISOString(),
      explanation:
        ratio >= 0.65
          ? 'The source contains most of the claim terms. Read the source context before treating this as conclusive.'
          : 'The source did not contain enough matching language to support this claim. Try another primary source.'
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'The source could not be checked.' },
      { status: 502 }
    );
  }
}
