import { limitRequest } from '@/lib/rate-limit';

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

function decode(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/<[^>]+>/g, '')
    .trim();
}

export async function POST(req: Request) {
  const limited = limitRequest(req, { key: 'research', limit: 12, windowMs: 60_000 });
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as { query?: unknown } | null;
  const query = typeof body?.query === 'string' ? body.query.trim().slice(0, 240) : '';
  if (!query) return Response.json({ error: 'Enter a research question.' }, { status: 400 });

  try {
    const response = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': 'AetherisResearch/1.0' }, signal: AbortSignal.timeout(8000) }
    );
    if (!response.ok) throw new Error(`Search provider returned ${response.status}.`);
    const html = await response.text();
    const results: SearchResult[] = [];
    const pattern =
      /<a rel="nofollow" class="result__a" href="([^"]+)">([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) && results.length < 6) {
      const url = decode(match[1]);
      if (!url.startsWith('http')) continue;
      results.push({ url, title: decode(match[2]), snippet: decode(match[3]) });
    }
    return Response.json({
      query,
      retrievedAt: new Date().toISOString(),
      results
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Live research is unavailable.' },
      { status: 502 }
    );
  }
}
