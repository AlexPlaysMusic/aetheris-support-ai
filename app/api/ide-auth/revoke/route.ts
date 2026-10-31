import { NextResponse } from 'next/server';
import { revokeIdeAccessToken } from '@/lib/ide-auth';
import { limitRequest } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const limited = limitRequest(request, {
    key: 'ide-auth-revoke',
    limit: 10,
    windowMs: 60_000
  });
  if (limited) return limited;

  try {
    const revoked = await revokeIdeAccessToken(request.headers.get('authorization'));
    if (!revoked) {
      return NextResponse.json(
        { error: 'VS Code session was not found or has expired.' },
        { status: 401 }
      );
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('[aetheris/vscode-auth] session revocation failed:', error);
    return NextResponse.json(
      { error: 'Could not revoke the VS Code session.' },
      { status: 503 }
    );
  }
}
