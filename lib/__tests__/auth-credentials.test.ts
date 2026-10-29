import { describe, expect, it } from 'vitest';
import {
  generateDesktopTicket,
  generateEmailCode,
  hashEmail,
  normalizeEmail
} from '../auth-credentials';

describe('authentication credentials', () => {
  it('generates six-digit email codes, including leading zeroes', () => {
    for (let index = 0; index < 100; index += 1) {
      expect(generateEmailCode()).toMatch(/^\d{6}$/);
    }
  });

  it('normalizes email identity keys without exposing the email address', () => {
    expect(normalizeEmail('  Example@Email.com ')).toBe('example@email.com');
    expect(hashEmail('Example@Email.com')).toBe(hashEmail(' example@email.com '));
    expect(hashEmail('example@email.com')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('generates unpredictable-format, 256-bit desktop handoff tickets', () => {
    const first = generateDesktopTicket();
    const second = generateDesktopTicket();
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
  });
});
