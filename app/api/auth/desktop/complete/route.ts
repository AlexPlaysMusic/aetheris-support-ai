import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import {
  generateDesktopTicket,
  saveDesktopTicket,
  type AuthUser
} from '@/lib/auth-credentials';

export async function GET() {
  const session = await getServerSession(authOptions);
  const user = session?.user;
  if (!user?.id || !user.email) {
    return NextResponse.json(
      { error: 'Google sign-in did not finish. Return to Aetheris and try again.' },
      { status: 401 }
    );
  }

  try {
    const ticket = generateDesktopTicket();
    const identity: AuthUser = {
      id: user.id,
      email: user.email,
      name: user.name ?? null,
      image: user.image ?? null
    };
    await saveDesktopTicket(ticket, identity);
    return NextResponse.redirect(`aetheris://auth?ticket=${ticket}`);
  } catch (error) {
    console.error('[aetheris/auth] desktop sign-in handoff failed:', error);
    return NextResponse.json(
      { error: 'Could not finish desktop sign-in. Please return to Aetheris and retry.' },
      { status: 503 }
    );
  }
}
