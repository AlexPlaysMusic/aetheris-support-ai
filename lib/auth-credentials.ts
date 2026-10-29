import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import { getSharedRedis } from './credit-server';

const EMAIL_CODE_TTL_SECONDS = 10 * 60;
const DESKTOP_TICKET_TTL_SECONDS = 2 * 60;

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
};

export function hashEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

function authSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET ?? '';
  if (secret === '') throw new Error('NEXTAUTH_SECRET is required for sign-in.');
  return secret;
}

function emailCodeKey(email: string): string {
  return `aetheris:auth:email-code:${hashEmail(email)}`;
}

function emailCodeAttemptKey(email: string): string {
  return `aetheris:auth:email-code-attempts:${hashEmail(email)}`;
}

function googleIdentityKey(email: string): string {
  return `aetheris:auth:google-email:${hashEmail(email)}`;
}

function codeDigest(email: string, code: string): string {
  return createHmac('sha256', authSecret())
    .update(`${email.trim().toLowerCase()}:${code}`)
    .digest('hex');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function generateEmailCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export async function saveEmailCode(email: string, code: string): Promise<void> {
  const redis = getSharedRedis();
  if (!redis) throw new Error('Email sign-in requires the configured Redis service.');
  await redis.set(emailCodeKey(email), codeDigest(email, code), {
    ex: EMAIL_CODE_TTL_SECONDS
  });
}

export async function deleteEmailCode(email: string): Promise<void> {
  const redis = getSharedRedis();
  if (!redis) return;
  await redis.del(emailCodeKey(email));
}

const VERIFY_EMAIL_CODE_SCRIPT = `
local stored = redis.call('GET', KEYS[1])
if not stored then
  return 0
end
if redis.call('GET', KEYS[2]) and tonumber(redis.call('GET', KEYS[2])) >= 5 then
  return 0
end
if stored == ARGV[1] then
  redis.call('DEL', KEYS[1], KEYS[2])
  return 1
end
local attempts = redis.call('INCR', KEYS[2])
if attempts == 1 then
  redis.call('EXPIRE', KEYS[2], 600)
end
if attempts >= 5 then
  redis.call('DEL', KEYS[1])
end
return 0
`;

export async function consumeEmailCode(
  email: string,
  code: string
): Promise<boolean> {
  const redis = getSharedRedis();
  if (!redis) throw new Error('Email sign-in requires the configured Redis service.');
  const result = await redis.eval<string[], number>(
    VERIFY_EMAIL_CODE_SCRIPT,
    [emailCodeKey(email), emailCodeAttemptKey(email)],
    [codeDigest(email, code)]
  );
  return result === 1;
}

export async function rememberGoogleIdentity(
  email: string,
  userId: string
): Promise<string> {
  const redis = getSharedRedis();
  if (!redis) return userId;
  await redis.set(googleIdentityKey(email), userId, { nx: true });
  return (await redis.get<string>(googleIdentityKey(email))) ?? userId;
}

export async function emailIdentity(email: string): Promise<string> {
  const redis = getSharedRedis();
  if (!redis) throw new Error('Email sign-in requires the configured Redis service.');
  const key = googleIdentityKey(email);
  const fallback = `email:${normalizeEmail(email)}`;
  await redis.set(key, fallback, { nx: true });
  return (await redis.get<string>(key)) ?? fallback;
}

function desktopTicketKey(ticket: string): string {
  return `aetheris:auth:desktop-ticket:${ticket}`;
}

export function generateDesktopTicket(): string {
  return randomBytes(32).toString('hex');
}

export async function saveDesktopTicket(
  ticket: string,
  user: AuthUser
): Promise<void> {
  const redis = getSharedRedis();
  if (!redis) throw new Error('Desktop sign-in requires the configured Redis service.');
  await redis.set(desktopTicketKey(ticket), JSON.stringify(user), {
    ex: DESKTOP_TICKET_TTL_SECONDS,
    nx: true
  });
}

const CONSUME_DESKTOP_TICKET_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if not value then
  return false
end
redis.call('DEL', KEYS[1])
return value
`;

export async function consumeDesktopTicket(
  ticket: string
): Promise<AuthUser | null> {
  if (!/^[a-f0-9]{64}$/.test(ticket)) return null;
  const redis = getSharedRedis();
  if (!redis) throw new Error('Desktop sign-in requires the configured Redis service.');
  const value = await redis.eval<string[], string | null>(
    CONSUME_DESKTOP_TICKET_SCRIPT,
    [desktopTicketKey(ticket)],
    []
  );
  if (typeof value !== 'string') return null;
  const user: unknown = JSON.parse(value);
  if (
    user === null ||
    typeof user !== 'object' ||
    typeof (user as Record<string, unknown>)['id'] !== 'string' ||
    typeof (user as Record<string, unknown>)['email'] !== 'string'
  ) {
    console.error('[aetheris/auth] stored desktop ticket had an invalid user payload');
    return null;
  }
  const record = user as Record<string, unknown>;
  return {
    id: record['id'] as string,
    email: record['email'] as string,
    name: typeof record['name'] === 'string' ? record['name'] : null,
    image: typeof record['image'] === 'string' ? record['image'] : null
  };
}
