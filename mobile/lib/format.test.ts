import { describe, expect, it } from 'vitest';
import {
  auditDate,
  auditDateTime,
  formatDate,
  formatRelative,
  parseDateOnly,
} from './format';

describe('audit timestamps', () => {
  it('formats valid dates for record metadata', () => {
    const value = '2026-09-13T09:35:00.000Z';

    expect(auditDate(value)).toContain('2026');
    expect(auditDateTime(value)).toMatch(/\d{1,2}:\d{2}/);
  });

  it('uses a safe fallback for missing or invalid values', () => {
    expect(auditDate(undefined)).toBe('—');
    expect(auditDateTime('invalid')).toBe('—');
  });
});

describe('parseDateOnly', () => {
  it('reads a date column as the local calendar day it names', () => {
    const d = parseDateOnly('2026-09-14');
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(8);
    expect(d?.getDate()).toBe(14);
  });

  it('returns null for an absent or unparseable value', () => {
    expect(parseDateOnly(null)).toBeNull();
    expect(parseDateOnly('')).toBeNull();
    expect(parseDateOnly('not a date')).toBeNull();
  });
});

describe('formatDate', () => {
  const now = new Date(2026, 9, 3, 12, 0, 0);

  it('omits the year within the current year', () => {
    expect(formatDate(new Date(2026, 9, 3, 11, 33).toISOString(), now)).toBe(
      '3 Oct'
    );
  });

  it('adds the year when it differs from the current year', () => {
    expect(formatDate(new Date(2025, 9, 3, 11, 33).toISOString(), now)).toBe(
      '3 Oct 2025'
    );
  });

  it('returns an empty string for an unparseable value', () => {
    expect(formatDate('not-a-date', now)).toBe('');
  });
});

describe('formatRelative', () => {
  const now = new Date(2026, 9, 3, 12, 0, 0);
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it('says just now under a minute and for future stamps', () => {
    expect(formatRelative(ago(20_000), now)).toBe('just now');
    expect(formatRelative(ago(-5 * 60_000), now)).toBe('just now');
  });

  it('counts minutes under an hour', () => {
    expect(formatRelative(ago(5 * 60_000), now)).toBe('5m ago');
  });

  it('counts hours within the day', () => {
    expect(formatRelative(ago(9 * HOUR), now)).toBe('9h ago');
  });

  it('names yesterday rather than counting 24 to 47 hours', () => {
    expect(formatRelative(ago(24 * HOUR), now)).toBe('yesterday');
    expect(formatRelative(ago(40 * HOUR), now)).toBe('yesterday');
  });

  it('counts days up to thirty', () => {
    expect(formatRelative(ago(4 * DAY), now)).toBe('4 days ago');
    expect(formatRelative(ago(30 * DAY), now)).toBe('30 days ago');
  });

  it('falls back to a real date beyond thirty days', () => {
    expect(formatRelative(ago(31 * DAY), now)).toBe('2 Sep');
    expect(formatRelative(ago(400 * DAY), now)).toBe('29 Aug 2025');
  });

  it('returns an empty string for an unparseable value', () => {
    expect(formatRelative('not-a-date', now)).toBe('');
  });
});
