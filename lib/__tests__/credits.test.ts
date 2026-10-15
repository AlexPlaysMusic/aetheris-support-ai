import { describe, expect, it, beforeEach } from 'vitest';
import {
  CREDIT_DAILY_ASTEROID,
  CREDIT_DAILY_GUEST,
  CREDIT_DAILY_PRO,
  CREDIT_DAILY_USER,
  creditIdentity,
  dailyAllowance,
  historyLimit,
  instructionsLimit,
  messageCost,
  refundCredits,
  remainingCredits,
  spendCredits,
  todayKey
} from '../credits';

function makeStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    raw: store
  };
}

const storage = makeStorage();

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true
  });
});

describe('creditIdentity', () => {
  it('gives guests the guest key and allowance', () => {
    const id = creditIdentity(null);
    expect(id.key).toContain('guest');
    expect(id.daily).toBe(CREDIT_DAILY_GUEST);
  });

  it('gives signed-in users their own key and allowance', () => {
    const id = creditIdentity('user-123');
    expect(id.key).toContain('user-123');
    expect(id.daily).toBe(CREDIT_DAILY_USER);
  });
});

describe('todayKey', () => {
  it('formats YYYY-MM-DD', () => {
    expect(todayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(todayKey(new Date(2026, 11, 25))).toBe('2026-12-25');
  });
});

describe('spendCredits', () => {
  it('deducts and persists day + used', () => {
    const id = creditIdentity(null);
    expect(spendCredits(id, 3)).toBe(CREDIT_DAILY_GUEST - 3);
    const raw = storage.getItem(id.key);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as { day: string; used: number };
    expect(parsed.used).toBe(3);
    expect(parsed.day).toBe(todayKey());
  });

  it('refuses overdraft without going negative', () => {
    const id = creditIdentity(null);
    expect(spendCredits(id, CREDIT_DAILY_GUEST + 5)).toBeNull();
    expect(remainingCredits(id)).toBe(CREDIT_DAILY_GUEST);
  });

  it('resets on a new day', () => {
    const id = creditIdentity(null);
    storage.setItem(id.key, JSON.stringify({ day: '2000-01-01', used: 999 }));
    expect(remainingCredits(id)).toBe(CREDIT_DAILY_GUEST);
  });
});

describe('refundCredits', () => {
  it('restores balance and caps at the daily allowance', () => {
    const id = creditIdentity(null);
    spendCredits(id, 5);
    expect(refundCredits(id, 2)).toBe(CREDIT_DAILY_GUEST - 3);
    expect(refundCredits(id, 100)).toBe(CREDIT_DAILY_GUEST);
  });
});

describe('messageCost', () => {
  it('prices tiers, images, and files', () => {
    expect(messageCost({ tier: 'basic', images: 0, files: 0 })).toBe(1);
    expect(messageCost({ tier: 'asteroid', images: 0, files: 0 })).toBe(2);
    expect(messageCost({ tier: 'pro', images: 0, files: 0 })).toBe(5);
    expect(messageCost({ tier: 'basic', images: 2, files: 0 })).toBe(5);
    expect(messageCost({ tier: 'basic', images: 0, files: 3 })).toBe(4);
    expect(messageCost({ tier: 'pro', images: 2, files: 1 })).toBe(10);
    expect(messageCost({ tier: 'asteroid', images: 1, files: 1 })).toBe(5);
  });
});

describe('tier budgets', () => {
  it('scales daily allowance, history, and instruction caps by tier', () => {
    expect(dailyAllowance('basic', false)).toBe(CREDIT_DAILY_GUEST);
    expect(dailyAllowance('basic', true)).toBe(CREDIT_DAILY_USER);
    expect(dailyAllowance('asteroid', true)).toBe(CREDIT_DAILY_ASTEROID);
    expect(dailyAllowance('pro', true)).toBe(CREDIT_DAILY_PRO);
    expect(historyLimit('basic')).toBe(30);
    expect(historyLimit('asteroid')).toBe(60);
    expect(historyLimit('pro')).toBe(100);
    expect(instructionsLimit('basic')).toBe(1000);
    expect(instructionsLimit('asteroid')).toBe(2000);
    expect(instructionsLimit('pro')).toBe(4000);
  });
});
