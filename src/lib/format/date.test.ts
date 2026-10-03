import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatRelative } from './date';

const now = new Date(2026, 9, 3, 12, 0, 0);

function local(y: number, m: number, d: number, h = 0, min = 0): string {
  return new Date(y, m - 1, d, h, min).toISOString();
}

describe('formatDateTime', () => {
  it('omits the year within the current year', () => {
    expect(formatDateTime(local(2026, 10, 3, 11, 33), now)).toBe(
      '3 Oct, 11:33 am'
    );
  });

  it('writes pm in lowercase', () => {
    expect(formatDateTime(local(2026, 9, 25, 18, 8), now)).toBe(
      '25 Sep, 6:08 pm'
    );
  });

  it('adds the year when it differs from the current year', () => {
    expect(formatDateTime(local(2025, 10, 3, 11, 33), now)).toBe(
      '3 Oct 2025, 11:33 am'
    );
  });

  it('switches on the year boundary', () => {
    const newYear = new Date(2027, 0, 1, 9, 0);
    expect(formatDateTime(local(2026, 12, 31, 23, 59), newYear)).toBe(
      '31 Dec 2026, 11:59 pm'
    );
    expect(formatDateTime(local(2027, 1, 1, 0, 5), newYear)).toBe(
      '1 Jan, 12:05 am'
    );
  });

  it('returns an empty string for an unparseable value', () => {
    expect(formatDateTime('not-a-date', now)).toBe('');
  });
});

describe('formatDate', () => {
  it('omits the year within the current year', () => {
    expect(formatDate(local(2026, 10, 3, 11, 33), now)).toBe('3 Oct');
  });

  it('adds the year when it differs from the current year', () => {
    expect(formatDate(local(2025, 10, 3), now)).toBe('3 Oct 2025');
  });

  it('reads a date-only column as the calendar day it names', () => {
    expect(formatDate('2026-10-10', now)).toBe('10 Oct');
    expect(formatDate('2027-01-01', now)).toBe('1 Jan 2027');
  });

  it('returns an empty string for an unparseable value', () => {
    expect(formatDate('', now)).toBe('');
  });
});

describe('formatRelative', () => {
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  it('says just now under a minute and for future stamps', () => {
    expect(formatRelative(ago(20_000), now)).toBe('just now');
    expect(formatRelative(ago(-5 * 60_000), now)).toBe('just now');
  });

  it('counts minutes under an hour', () => {
    expect(formatRelative(ago(5 * 60_000), now)).toBe('5m ago');
  });

  it('counts hours within the day', () => {
    expect(formatRelative(ago(4 * HOUR), now)).toBe('4h ago');
    expect(formatRelative(ago(23 * HOUR + 30 * 60_000), now)).toBe('23h ago');
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
