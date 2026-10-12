import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { Resend } from 'resend';

const SUPPORT_FROM = 'Aetheris Support <support@aetherisai.me>';
const SUPPORT_MODEL = process.env.SUPPORT_MODEL ?? 'gemini-3.8-flash';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * AI support inbox: Gemini drafts a helpful reply to the user's message,
 * Resend delivers it from support@aetherisai.me.
 *
 * Required env: RESEND_API_KEY (plus a verified sending domain in Resend),
 * and GEMINI_API_KEY (falls back to the existing GOOGLE_GENERATIVE_AI_API_KEY
 * so the same key doesn't have to be configured twice).
 */
export async function POST(req: Request) {
  try {
    const apiKey =
      process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '';
    if (apiKey === '') {
      return NextResponse.json(
        { error: 'AI support is not configured yet.' },
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

    // 1. Have Gemini generate a helpful support response.
    const ai = new GoogleGenAI({ apiKey });
    const aiResponse = await ai.models.generateContent({
      model: SUPPORT_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `You are the official AI support assistant for Aetheris, a high-performance AI chat web application.
              Write a polite, helpful, and concise response to this user support message: "${message.slice(0, 2000)}".
              Sign off from "Aetheris AI Support".`
            }
          ]
        }
      ]
    });

    const replyText =
      aiResponse.text ||
      'Thank you for reaching out to Aetheris Support. We have received your message and will get back to you shortly.';

    // 2. Send the AI-generated response via Resend from our domain.
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
    console.error('[aetheris/support] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Support request failed.' },
      { status: 500 }
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
