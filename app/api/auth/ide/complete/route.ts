import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import {
  generateDesktopTicket,
  saveDesktopTicket,
  type AuthUser
} from '@/lib/auth-credentials';
import { consumeIdeAuthState } from '@/lib/ide-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const state = requestUrl.searchParams.get('state') ?? '';
  if (!/^[a-f0-9]{64}$/.test(state)) {
    return NextResponse.json({ error: 'Invalid or expired VS Code sign-in.' }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const user = session?.user;
  if (!user?.id || !user.email) {
    const signInUrl = new URL('/ide-auth/start', request.url);
    signInUrl.searchParams.set('state', state);
    return NextResponse.redirect(signInUrl);
  }

  try {
    if (!(await consumeIdeAuthState(state))) {
      return NextResponse.json(
        { error: 'This VS Code sign-in link has expired or was already used.' },
        { status: 400 }
      );
    }
    const ticket = generateDesktopTicket();
    const identity: AuthUser = {
      id: user.id,
      email: user.email,
      name: user.name ?? null,
      image: user.image ?? null
    };
    await saveDesktopTicket(ticket, identity);
    const callback = new URL('vscode://aetheris.aetheris-ai/auth');
    callback.searchParams.set('ticket', ticket);
    callback.searchParams.set('state', state);
    return NextResponse.redirect(callback, {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    console.error('[aetheris/ide-auth] sign-in handoff failed:', error);
    return NextResponse.json(
      { error: 'Could not finish VS Code sign-in. Please try again.' },
      { status: 503 }
    );
  }
}
