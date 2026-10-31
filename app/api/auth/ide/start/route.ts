import { NextResponse } from 'next/server';
import { limitRequest } from '@/lib/rate-limit';
import { readBoundedJson, RequestBodyTooLargeError } from '@/lib/request-body';
import { saveIdeAuthState } from '@/lib/ide-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const limited = limitRequest(request, {
    key: 'ide-auth-start',
    limit: 10,
    windowMs: 60_000
  });
  if (limited) return limited;

  try {
    const body = await readBoundedJson(request, 2048);
    const state =
      body !== null && typeof body === 'object'
        ? (body as Record<string, unknown>)['state']
        : null;
    if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state)) {
      return NextResponse.json({ error: 'Invalid sign-in request.' }, { status: 400 });
    }

    await saveIdeAuthState(state);
    const siteUrl = process.env.NEXTAUTH_URL || 'https://www.aetherisai.me';
    const authorizationUrl = new URL('/ide-auth/start', siteUrl);
    authorizationUrl.searchParams.set('state', state);
    return NextResponse.json(
      { authorizationUrl: authorizationUrl.toString() },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }
    console.error('[aetheris/ide-auth] could not start sign-in:', error);
    return NextResponse.json(
      { error: 'VS Code sign-in is temporarily unavailable.' },
      { status: 503 }
    );
  }
}
