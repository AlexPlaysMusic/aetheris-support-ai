import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { Resend } from 'resend';
import {
  createAetherisLanguageModel,
  findAetherisModel,
  getAetherisInferenceConfig
} from '@/lib/aetheris-inference';
import { limitRequest } from '@/lib/rate-limit';

const SUPPORT_FROM = 'Aetheris Support <support@aetherisai.me>';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isCapacityError(err: unknown): boolean {
  const text = err instanceof Error ? `${err.message} ${JSON.stringify(err)}` : String(err);
  return /503|429|overload|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|capacity|timeout|timed out/i.test(
    text
  );
}

/**
 * AI support inbox: Aetheris inference drafts a helpful reply to the user's message,
 * Resend delivers it from support@aetherisai.me.
 *
 * Required env: RESEND_API_KEY plus a configured Aetheris inference backend.
 */
export async function POST(req: Request) {
  const limited = limitRequest(req, { key: 'support', limit: 5, windowMs: 60_000 });
  if (limited) return limited;
  try {
    const config = getAetherisInferenceConfig();
    const model = findAetherisModel('aetheris-basic', config);
    if (!model || !config.baseUrl || !config.apiKey) {
      return NextResponse.json(
        { error: 'Aetheris AI support inference is not configured yet.' },
        { status: 503 }
      );
    }
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json(
        { error: 'Email delivery is not configured yet.' },
        { status: 503 }
      );
    }

    const body: unknown = await req.json();
    const record =
      body !== null && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : {};
    const email =
      typeof record['email'] === 'string' ? record['email'].trim() : '';
    const message =
      typeof record['message'] === 'string' ? record['message'].trim() : '';

    if (!EMAIL_RE.test(email) || message === '') {
      return NextResponse.json(
        { error: 'A valid email and a message are required.' },
        { status: 400 }
      );
    }

    const generated = await generateText({
      model: createAetherisLanguageModel(model, config),
      prompt: `You are the official AI support assistant for Aetheris. Write a polite, helpful, and concise response to this support message. Keep the reply strictly professional and never sexual or explicit. Sign off from "Aetheris AI Support".\n\nSupport message:\n${message.slice(0, 2000)}`,
      maxTokens: 700,
      temperature: 0.4
    });
    const replyText = generated.text.trim();
    if (replyText === '') {
      return NextResponse.json(
        { error: 'Aetheris AI returned an empty support response.' },
        { status: 502 }
      );
    }

    // Send the AI-generated response via Resend from our domain.
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error: sendError } = await resend.emails.send({
      from: SUPPORT_FROM,
      to: [email],
      replyTo: 'support@aetherisai.me',
      subject: 'Aetheris Support — Response to your request',
      html: `
        <div style="font-family: sans-serif; background-color: #09090b; color: #ffffff; padding: 24px; border-radius: 8px; max-width: 500px;">
          <div style="text-align: center; margin-bottom: 8px;">
            <img src="https://www.aetherisai.me/aetheris-email.png" width="72" height="72" alt="Aetheris" style="display: inline-block;" />
            <h2 style="margin: 8px 0 0; color: #ffffff; letter-spacing: 0.5px;">Aetheris Support</h2>
          </div>
          <p style="color: #a1a1aa; font-size: 14px;">Your message: "${escapeHtml(message).slice(0, 2000)}"</p>
          <hr style="border-color: #27272a; margin: 16px 0;" />
          <div style="color: #e4e4e7; font-size: 15px; line-height: 1.5;">
            ${escapeHtml(replyText).replace(/\n/g, '<br />')}
          </div>
          <hr style="border-color: #27272a; margin: 16px 0;" />
          <p style="color: #71717a; font-size: 12px;">Automated AI response from support@aetherisai.me</p>
        </div>
      `
    });

    if (sendError) {
      console.error('[aetheris/support] resend error:', sendError);
      return NextResponse.json(
        { error: 'Could not send the reply email. Please try again.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, reply: replyText });
  } catch (err) {
    console.error(
      '[aetheris/support] inference or delivery failed:',
      err instanceof Error ? err.name : 'unknown error'
    );
    if (isCapacityError(err)) {
      return NextResponse.json(
        {
          error:
            'Support AI is at capacity right now — try again in a minute.'
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: 'Could not complete the support request. Please try again later.' },
      { status: 503 }
    );
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
