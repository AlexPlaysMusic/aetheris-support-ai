import { createHash, randomBytes } from 'node:crypto';
import { getSharedRedis } from './credit-server';
import type { AuthUser } from './auth-credentials';

const IDE_STATE_TTL_SECONDS = 10 * 60;
const IDE_ACCESS_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const IDE_STATE_PREFIX = 'aetheris:auth:ide-state:';
const IDE_TOKEN_PREFIX = 'aetheris:auth:ide-token:';
const IDE_STATE_PATTERN = /^[a-f0-9]{64}$/;
const IDE_TOKEN_PATTERN = /^aeth_vscode_[A-Za-z0-9_-]{43}$/;

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function redisOrThrow() {
  const redis = getSharedRedis();
  if (!redis) throw new Error('VS Code sign-in requires the configured Redis service.');
  return redis;
}

export async function saveIdeAuthState(state: string): Promise<void> {
  if (!IDE_STATE_PATTERN.test(state)) throw new Error('Invalid VS Code sign-in state.');
  const redis = redisOrThrow();
  const result = await redis.set(
    `${IDE_STATE_PREFIX}${digest(state)}`,
    'pending',
    { ex: IDE_STATE_TTL_SECONDS, nx: true }
  );
  if (result !== 'OK') throw new Error('Could not reserve VS Code sign-in state.');
}

const CONSUME_IDE_STATE_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if value ~= 'pending' then
  return 0
end
redis.call('DEL', KEYS[1])
return 1
`;

export async function consumeIdeAuthState(state: string): Promise<boolean> {
  if (!IDE_STATE_PATTERN.test(state)) return false;
  const redis = redisOrThrow();
  const result = await redis.eval<string[], number>(
    CONSUME_IDE_STATE_SCRIPT,
    [`${IDE_STATE_PREFIX}${digest(state)}`],
    []
  );
  return result === 1;
}

function tokenKey(token: string): string {
  return `${IDE_TOKEN_PREFIX}${digest(token)}`;
}

function validUser(value: unknown): value is AuthUser {
  if (value === null || typeof value !== 'object') return false;
  const user = value as Record<string, unknown>;
  return (
    typeof user['id'] === 'string' &&
    user['id'] !== '' &&
    typeof user['email'] === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user['email']) &&
    (user['name'] === null || typeof user['name'] === 'string') &&
    (user['image'] === null || typeof user['image'] === 'string')
  );
}

export async function createIdeAccessToken(
  user: AuthUser
): Promise<{ token: string; expiresAt: string }> {
  const redis = redisOrThrow();
  const token = `aeth_vscode_${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(
    Date.now() + IDE_ACCESS_TOKEN_TTL_SECONDS * 1000
  ).toISOString();
  const result = await redis.set(
    tokenKey(token),
    JSON.stringify({ user, expiresAt }),
    { ex: IDE_ACCESS_TOKEN_TTL_SECONDS, nx: true }
  );
  if (result !== 'OK') throw new Error('Could not reserve a VS Code access token.');
  return { token, expiresAt };
}

export async function authenticateIdeAccessToken(
  authorization: string | null
): Promise<AuthUser | null> {
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice(7).trim();
  if (!IDE_TOKEN_PATTERN.test(token)) return null;
  const redis = redisOrThrow();
  const value = await redis.get<string>(tokenKey(token));
  if (typeof value !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  if (
    typeof record['expiresAt'] !== 'string' ||
    Date.parse(record['expiresAt']) <= Date.now() ||
    !validUser(record['user'])
  ) {
    return null;
  }
  return record['user'];
}

export async function revokeIdeAccessToken(
  authorization: string | null
): Promise<boolean> {
  if (!authorization?.startsWith('Bearer ')) return false;
  const token = authorization.slice(7).trim();
  if (!IDE_TOKEN_PATTERN.test(token)) return false;
  const redis = redisOrThrow();
  return (await redis.del(tokenKey(token))) > 0;
}
