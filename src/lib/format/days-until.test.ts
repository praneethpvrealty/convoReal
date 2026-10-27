import { describe, expect, it } from 'vitest';

import { daysUntil } from './days-until';

describe('daysUntil', () => {
  const now = new Date('2026-10-27T06:00:00Z').getTime();

  it('counts whole days up to a future date', () => {
    expect(daysUntil('2026-11-16T06:00:00Z', now)).toBe(20);
    expect(daysUntil('2026-10-27T18:00:00Z', now)).toBe(1);
  });

  it('never goes below zero and ignores missing or bad dates', () => {
    expect(daysUntil('2026-10-01T00:00:00Z', now)).toBe(0);
    expect(daysUntil(null, now)).toBeNull();
    expect(daysUntil('not a date', now)).toBeNull();
  });
});
