import { describe, expect, it } from 'vitest';

import { EDIT_SEED_MAX_AGE_MS, isFreshSeed } from './query-seed';

describe('isFreshSeed', () => {
  const now = 1_800_000_000_000;

  it('accepts a copy fetched within the window', () => {
    expect(isFreshSeed(now - 80_000, now)).toBe(true);
    expect(isFreshSeed(now - EDIT_SEED_MAX_AGE_MS, now)).toBe(true);
  });

  it('refuses a copy older than the window, such as one restored from the persisted cache', () => {
    expect(isFreshSeed(now - EDIT_SEED_MAX_AGE_MS - 1, now)).toBe(false);
    expect(isFreshSeed(now - 24 * 60 * 60 * 1000, now)).toBe(false);
  });

  it('refuses a query that never fetched', () => {
    expect(isFreshSeed(undefined, now)).toBe(false);
    expect(isFreshSeed(0, now)).toBe(false);
  });
});
