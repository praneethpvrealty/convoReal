import { describe, expect, it } from 'vitest';

import { clockTime, listTime } from './list-time';

const NOW = new Date(2026, 9, 27, 10, 0);

function at(year: number, month: number, day: number, hour = 9, minute = 0) {
  return new Date(year, month, day, hour, minute).toISOString();
}

describe('[UIX-005] listTime', () => {
  it('shows the clock time for a moment earlier today', () => {
    const iso = at(2026, 9, 27, 8, 5);
    expect(listTime(iso, NOW)).toBe(clockTime(iso));
    expect(listTime(iso, NOW)).toMatch(/^8:05\s?am$/i);
  });

  it('names yesterday and tomorrow', () => {
    expect(listTime(at(2026, 9, 26), NOW)).toBe('Yesterday');
    expect(listTime(at(2026, 9, 28), NOW)).toBe('Tomorrow');
  });

  it('shows a short weekday for the past six days', () => {
    expect(listTime(at(2026, 9, 25), NOW)).toBe('Sun');
    expect(listTime(at(2026, 9, 21), NOW)).toBe('Wed');
  });

  it('shows a date from a week back', () => {
    expect(listTime(at(2026, 9, 20), NOW)).toBe('20 Oct');
  });

  it('never shows a bare weekday for a future date', () => {
    expect(listTime(at(2026, 9, 30), NOW)).toBe('30 Oct');
    expect(listTime(at(2026, 10, 16), NOW)).toBe('16 Nov');
  });

  it('adds the year for another year', () => {
    expect(listTime(at(2025, 9, 27), NOW)).toBe('27 Oct 2025');
  });

  it('returns an empty string for a missing or invalid value', () => {
    expect(listTime(undefined, NOW)).toBe('');
    expect(listTime(null, NOW)).toBe('');
    expect(listTime('not a date', NOW)).toBe('');
  });
});

describe('[UIX-005] clockTime', () => {
  it('reads as a 12-hour clock with minutes', () => {
    expect(clockTime(at(2026, 9, 27, 22, 30))).toMatch(/^10:30\s?pm$/i);
    expect(clockTime(at(2026, 9, 27, 9, 5))).toMatch(/^9:05\s?am$/i);
  });

  it('returns an empty string for a missing or invalid value', () => {
    expect(clockTime(undefined)).toBe('');
    expect(clockTime('nope')).toBe('');
  });
});
