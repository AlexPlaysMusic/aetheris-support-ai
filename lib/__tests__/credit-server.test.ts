import { describe, expect, it } from 'vitest';
import {
  CREDIT_DAILY_ASTEROID,
  CREDIT_DAILY_GUEST,
  CREDIT_DAILY_PRO,
  CREDIT_DAILY_USER
} from '../credits';
import { strictIdentityFor } from '../credit-server';

describe('strictIdentityFor', () => {
  it('uses the same account identity with the correct tier allowance', () => {
    expect(strictIdentityFor('google-user', null)).toEqual({
      kind: 'user',
      id: 'google-user',
      daily: CREDIT_DAILY_USER
    });
    expect(strictIdentityFor('google-user', null, 'asteroid')).toEqual({
      kind: 'user',
      id: 'google-user',
      daily: CREDIT_DAILY_ASTEROID
    });
    expect(strictIdentityFor('google-user', null, 'pro')).toEqual({
      kind: 'user',
      id: 'google-user',
      daily: CREDIT_DAILY_PRO
    });
  });

  it('keeps guests keyed by IP and on the guest allowance', () => {
    expect(strictIdentityFor(null, '203.0.113.1', 'pro')).toEqual({
      kind: 'guest',
      id: '203.0.113.1',
      daily: CREDIT_DAILY_GUEST
    });
  });
});
