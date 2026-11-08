import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  authenticateApiKey,
  checkApiKeyRateLimit,
  createApiKey,
  hashApiKey,
  listApiKeys,
  recordApiKeyTokens,
  recordApiKeyUsage,
  refreshApiKeyClaims,
  resetApiKeyStore,
  revokeApiKey
} from '../aetheris-api-keys';

describe('Aetheris API key validation', () => {
  beforeEach(() => {
    process.env.AETHERIS_KEY_STORE = 'memory';
    resetApiKeyStore();
  });

  afterEach(() => {
    delete process.env.AETHERIS_KEY_STORE;
    resetApiKeyStore();
  });

  it('hashes key material deterministically', () => {
    expect(hashApiKey('aeth_sk_live_example')).toBe(hashApiKey('aeth_sk_live_example'));
    expect(hashApiKey('aeth_sk_live_example')).not.toBe(hashApiKey('aeth_sk_live_other'));
  });

  it('rejects malformed or absent bearer keys without contacting the store', async () => {
    await expect(authenticateApiKey(null)).resolves.toBeNull();
    await expect(authenticateApiKey('Basic abc')).resolves.toBeNull();
    await expect(authenticateApiKey('Bearer malformed')).resolves.toBeNull();
  });

  it('runs the full create → use → revoke lifecycle', async () => {
    const { key, record } = await createApiKey('user-1', 'CI bot');
    expect(key).toMatch(/^aeth_sk_live_[A-Za-z0-9_-]{43}$/);
    expect(record.ownerId).toBe('user-1');

    const authed = await authenticateApiKey(`Bearer ${key}`);
    expect(authed?.id).toBe(record.id);
    expect(authed?.label).toBe('CI bot');

    const listed = await listApiKeys('user-1');
    expect(listed).toHaveLength(1);
    expect(listed[0].requestCount).toBe(0);

    await recordApiKeyUsage(record.id);
    await recordApiKeyTokens(record.id, 12, 34);
    const used = await listApiKeys('user-1');
    expect(used[0].requestCount).toBe(1);
    expect(used[0].promptTokens).toBe(12);
    expect(used[0].completionTokens).toBe(34);
    expect(used[0].lastUsedAt).toBeTruthy();

    expect(await revokeApiKey('user-1', record.id)).toBe(true);
    await expect(authenticateApiKey(`Bearer ${key}`)).resolves.toBeNull();
    const afterRevoke = await listApiKeys('user-1');
    expect(afterRevoke[0].revokedAt).toBeTruthy();

    // Revoking twice or by a different owner fails.
    expect(await revokeApiKey('user-1', record.id)).toBe(false);
    expect(await revokeApiKey('someone-else', record.id)).toBe(false);
    // A different owner cannot see the key.
    expect(await listApiKeys('someone-else')).toHaveLength(0);
  });

  it('carries membership claims and refreshes them', async () => {
    const { record } = await createApiKey('user-2', 'pro app', {
      tier: 'pro',
      subscriptionId: 'sub-1'
    });
    const authed = await authenticateApiKey(
      `Bearer aeth_sk_live_${'a'.repeat(43)}`
    );
    expect(authed).toBeNull(); // wrong material never matches

    const [listed] = await listApiKeys('user-2');
    expect(listed.claimTier).toBe('pro');
    expect(listed.claimSubscriptionId).toBe('sub-1');

    // Refresh upgrades an existing claim to the current plan.
    const changed = await refreshApiKeyClaims('user-2', {
      tier: 'asteroid',
      subscriptionId: 'sub-2'
    });
    expect(changed).toBe(1);
    const [refreshed] = await listApiKeys('user-2');
    expect(refreshed.claimTier).toBe('asteroid');
    expect(refreshed.claimSubscriptionId).toBe('sub-2');

    // No-op refresh when nothing changed.
    expect(
      await refreshApiKeyClaims('user-2', { tier: 'asteroid', subscriptionId: 'sub-2' })
    ).toBe(0);
    expect(record.revokedAt).toBeNull();
  });

  it('enforces the per-key rate limit', async () => {
    const { record } = await createApiKey('user-3', 'limited');
    expect(await checkApiKeyRateLimit(record.id, 2)).toBe(true);
    expect(await checkApiKeyRateLimit(record.id, 2)).toBe(true);
    expect(await checkApiKeyRateLimit(record.id, 2)).toBe(false);
  });
});
