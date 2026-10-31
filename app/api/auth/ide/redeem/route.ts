import { NextResponse } from 'next/server';
import { consumeDesktopTicket } from '@/lib/auth-credentials';
import { createIdeAccessToken } from '@/lib/ide-auth';
import { readBoundedJson, RequestBodyTooLargeError } from '@/lib/request-body';
import { limitRequest } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const limited = limitRequest(request, {
    key: 'ide-auth-redeem',
    limit: 10,
    windowMs: 60_000
  });
  if (limited) return limited;

  try {
    const body = await readBoundedJson(request, 2048);
    const ticket =
      body !== null && typeof body === 'object'
        ? (body as Record<string, unknown>)['ticket']
        : null;
    if (typeof ticket !== 'string' || !/^[a-f0-9]{64}$/.test(ticket)) {
      return NextResponse.json({ error: 'Invalid sign-in ticket.' }, { status: 400 });
    }

    const user = await consumeDesktopTicket(ticket);
    if (!user) {
      return NextResponse.json(
        { error: 'This sign-in ticket has expired or was already used.' },
        { status: 401 }
      );
    }
    const access = await createIdeAccessToken(user);
    return NextResponse.json(
      {
        accessToken: access.token,
        expiresAt: access.expiresAt,
        user: { email: user.email, name: user.name }
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }
    console.error('[aetheris/ide-auth] sign-in ticket redemption failed:', error);
    return NextResponse.json(
      { error: 'Could not finish VS Code sign-in. Please try again.' },
      { status: 503 }
    );
  }
}
