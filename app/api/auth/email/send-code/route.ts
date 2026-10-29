import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { getSharedRedis } from '@/lib/credit-server';
import {
  deleteEmailCode,
  generateEmailCode,
  hashEmail,
  normalizeEmail,
  saveEmailCode
} from '@/lib/auth-credentials';
import { limitRequest } from '@/lib/rate-limit';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_FROM = 'Aetheris Support <support@aetherisai.me>';

async function clearPendingCode(email: string): Promise<void> {
  try {
    await deleteEmailCode(email);
  } catch (error) {
    console.error('[aetheris/auth] could not clear undelivered verification code:', error);
  }
}

export async function POST(req: Request) {
  const limited = limitRequest(req, {
    key: 'auth-email-code',
    limit: 5,
    windowMs: 15 * 60_000
  });
  if (limited) return limited;

  const redis = getSharedRedis();
  if (!redis || !process.env.RESEND_API_KEY || !process.env.NEXTAUTH_SECRET) {
    return NextResponse.json(
      { error: 'Email sign-in is not configured yet. Please use Google sign-in.' },
      { status: 503 }
    );
  }

  let savedCodeEmail: string | null = null;
  try {
    const body: unknown = await req.json();
    const record =
      body !== null && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : {};
    const email =
      typeof record['email'] === 'string' ? normalizeEmail(record['email']) : '';
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }

    const emailRateKey = `aetheris:auth:email-send-limit:${hashEmail(email)}`;
    const emailAttempts = await redis.incr(emailRateKey);
    if (emailAttempts === 1) await redis.expire(emailRateKey, 15 * 60);
    if (emailAttempts > 3) {
      return NextResponse.json(
        { error: 'Too many codes requested for this email. Try again in 15 minutes.' },
        { status: 429 }
      );
    }

    const code = generateEmailCode();
    await saveEmailCode(email, code);
    savedCodeEmail = email;
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: [email],
      subject: 'Your Aetheris sign-in code',
      html: `
        <div style="font-family: sans-serif; background: #09090b; color: #fff; padding: 28px; border-radius: 12px; max-width: 480px;">
          <h1 style="font-size: 20px; margin: 0 0 12px;">Sign in to Aetheris</h1>
          <p style="color: #cbd5e1; line-height: 1.6;">Enter this one-time code to finish signing in. It expires in 10 minutes.</p>
          <p style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #67e8f9; margin: 24px 0;">${code}</p>
          <p style="font-size: 12px; color: #94a3b8;">If you didn't request this code, you can ignore this message.</p>
        </div>
      `
    });

    if (error) {
      console.error('[aetheris/auth] verification email delivery failed:', error);
      await clearPendingCode(email);
      savedCodeEmail = null;
      return NextResponse.json(
        { error: 'Could not send your sign-in code. Please try again.' },
        { status: 502 }
      );
    }
    savedCodeEmail = null;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[aetheris/auth] email code request failed:', error);
    if (savedCodeEmail) await clearPendingCode(savedCodeEmail);
    return NextResponse.json(
      { error: 'Could not send your sign-in code. Please try again.' },
      { status: 500 }
    );
  }
}
