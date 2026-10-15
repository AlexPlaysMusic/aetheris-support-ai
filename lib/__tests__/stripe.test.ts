import { describe, expect, it } from 'vitest';
import {
  membershipFromMetadata,
  routeStripeEvent,
  tierFromLookupKey
} from '../stripe';

describe('tierFromLookupKey', () => {
  it('maps lookup keys to tiers', () => {
    expect(tierFromLookupKey('aetheris-asteroid-monthly')).toBe('asteroid');
    expect(tierFromLookupKey('aetheris-pro-monthly')).toBe('pro');
    expect(tierFromLookupKey('something-else')).toBeNull();
    expect(tierFromLookupKey(undefined)).toBeNull();
    expect(tierFromLookupKey(42)).toBeNull();
  });
});

describe('membershipFromMetadata', () => {
  it('extracts user and tier, rejecting junk', () => {
    expect(
      membershipFromMetadata({ userId: 'u1', tier: 'pro' })
    ).toEqual({ userId: 'u1', tier: 'pro' });
    expect(
      membershipFromMetadata({ userId: 'u1', tier: 'enterprise' })
    ).toEqual({ userId: 'u1', tier: null });
    expect(membershipFromMetadata({ userId: '' })).toEqual({
      userId: null,
      tier: null
    });
    expect(membershipFromMetadata(null)).toEqual({
      userId: null,
      tier: null
    });
    expect(membershipFromMetadata('nope')).toEqual({
      userId: null,
      tier: null
    });
  });
});

describe('routeStripeEvent', () => {
  it('activates on completed checkout with metadata', () => {
    expect(
      routeStripeEvent({
        type: 'checkout.session.completed',
        data: {
          object: {
            subscription: 'sub_1',
            metadata: { userId: 'u1', tier: 'asteroid' }
          }
        }
      })
    ).toEqual({
      action: 'activate',
      userId: 'u1',
      tier: 'asteroid',
      subscriptionId: 'sub_1'
    });
  });

  it('ignores checkout without usable metadata', () => {
    expect(
      routeStripeEvent({
        type: 'checkout.session.completed',
        data: { object: { subscription: 'sub_1', metadata: {} } }
      })
    ).toBeNull();
  });

  it('deactivates on deleted subscriptions', () => {
    expect(
      routeStripeEvent({
        type: 'customer.subscription.deleted',
        data: {
          object: { metadata: { userId: 'u1', tier: 'pro' } }
        }
      })
    ).toEqual({ action: 'deactivate', userId: 'u1' });
  });

  it('deactivates on non-active updates, ignores active ones', () => {
    expect(
      routeStripeEvent({
        type: 'customer.subscription.updated',
        data: {
          object: {
            status: 'past_due',
            metadata: { userId: 'u1', tier: 'pro' }
          }
        }
      })
    ).toEqual({ action: 'deactivate', userId: 'u1' });
    expect(
      routeStripeEvent({
        type: 'customer.subscription.updated',
        data: {
          object: {
            status: 'active',
            metadata: { userId: 'u1', tier: 'pro' }
          }
        }
      })
    ).toBeNull();
  });

  it('ignores unrelated events', () => {
    expect(
      routeStripeEvent({
        type: 'invoice.paid',
        data: { object: {} }
      })
    ).toBeNull();
  });
});
