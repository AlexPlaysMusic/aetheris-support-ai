import { beforeEach, describe, expect, it, vi } from 'vitest';

const { redis } = vi.hoisted(() => ({
  redis: {
    set: vi.fn(),
    get: vi.fn(),
    eval: vi.fn(),
    del: vi.fn()
  }
}));

vi.mock('../credit-server', () => ({
  getSharedRedis: () => redis
}));

import {
  authenticateIdeAccessToken,
  consumeIdeAuthState,
  createIdeAccessToken,
  revokeIdeAccessToken,
  saveIdeAuthState
} from '../ide-auth';

const user = {
  id: 'user-123',
  email: 'person@example.com',
  name: 'Aetheris User',
  image: null
};

describe('VS Code sign-in credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redis.set.mockResolvedValue('OK');
    redis.eval.mockResolvedValue(1);
    redis.del.mockResolvedValue(1);
  });

  it('stores one-time OAuth state as a digest and consumes it atomically', async () => {
    const state = 'a'.repeat(64);
    await saveIdeAuthState(state);

    const storedKey = redis.set.mock.calls[0]?.[0];
    expect(storedKey).toMatch(/^aetheris:auth:ide-state:[a-f0-9]{64}$/);
    expect(storedKey).not.toContain(state);
    await expect(consumeIdeAuthState(state)).resolves.toBe(true);
    expect(redis.eval).toHaveBeenCalledOnce();
  });

  it('keeps bearer credentials out of Redis keys and stores only their digest', async () => {
    const { token } = await createIdeAccessToken(user);
    const [storedKey, storedValue] = redis.set.mock.calls[0] ?? [];

    expect(token).toMatch(/^aeth_vscode_[A-Za-z0-9_-]{43}$/);
    expect(storedKey).toMatch(/^aetheris:auth:ide-token:[a-f0-9]{64}$/);
    expect(storedKey).not.toContain(token);
    expect(storedValue).not.toContain(token);

    redis.get.mockResolvedValue(storedValue);
    await expect(
      authenticateIdeAccessToken(`Bearer ${token}`)
    ).resolves.toEqual(user);
    await expect(revokeIdeAccessToken(`Bearer ${token}`)).resolves.toBe(true);
  });

  it('rejects malformed, missing, and expired extension tokens', async () => {
    await expect(authenticateIdeAccessToken(null)).resolves.toBeNull();
    await expect(authenticateIdeAccessToken('Bearer invalid')).resolves.toBeNull();

    const { token } = await createIdeAccessToken(user);
    redis.get.mockResolvedValue(
      JSON.stringify({
        user,
        expiresAt: new Date(Date.now() - 1000).toISOString()
      })
    );
    await expect(
      authenticateIdeAccessToken(`Bearer ${token}`)
    ).resolves.toBeNull();
  });
});
