import { describe, expect, it } from 'vitest';
import { authenticateApiKey, hashApiKey } from '../aetheris-api-keys';

describe('Aetheris API key validation', () => {
  it('hashes key material deterministically', () => {
    expect(hashApiKey('aeth_sk_live_example')).toBe(hashApiKey('aeth_sk_live_example'));
    expect(hashApiKey('aeth_sk_live_example')).not.toBe(hashApiKey('aeth_sk_live_other'));
  });

  it('rejects malformed or absent bearer keys without contacting Redis', async () => {
    await expect(authenticateApiKey(null)).resolves.toBeNull();
    await expect(authenticateApiKey('Basic abc')).resolves.toBeNull();
    await expect(authenticateApiKey('Bearer malformed')).resolves.toBeNull();
  });
});
