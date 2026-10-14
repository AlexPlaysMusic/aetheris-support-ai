import { getSharedRedis } from '@/lib/credit-server';
import { limitRequest } from '@/lib/rate-limit';

const WAITLIST_KEY = 'aetheris:waitlist';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Join the Pro waitlist. Stores the email in a Redis set (unique by
 * address) and returns the queue position. Requires Redis — without it
 * the waitlist is unavailable (503) rather than silently dropping signups.
 */
export async function POST(req: Request) {
  const limited = limitRequest(req, { key: 'waitlist', limit: 10, windowMs: 60_000 });
  if (limited) return limited;
  try {
    const body: unknown = await req.json();
    const record =
      body !== null && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : {};
    const email =
      typeof record['email'] === 'string'
        ? record['email'].trim().toLowerCase()
        : '';
    if (email === '' || email.length > 254 || !EMAIL_RE.test(email)) {
      return Response.json(
        { error: 'Enter a valid email address.' },
        { status: 400 }
      );
    }

    const redis = getSharedRedis();
    if (!redis) {
      return Response.json(
        {
          error: 'WAITLIST_UNAVAILABLE',
          message: 'The waitlist is temporarily unavailable — try again later.'
        },
        { status: 503 }
      );
    }

    await redis.sadd(WAITLIST_KEY, email);
    const position = await redis.scard(WAITLIST_KEY);
    return Response.json({ ok: true, position });
  } catch (err) {
    console.error('[aetheris/waitlist] error:', err);
    return Response.json(
      { error: 'Could not join the waitlist. Please try again.' },
      { status: 500 }
    );
  }
}
