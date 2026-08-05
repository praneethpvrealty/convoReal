import { describe, expect, it } from 'vitest';

import { isoDateOrNull } from './iso-date';

/**
 * Day-granularity dates (possession, lease start/end) stay strings all
 * the way through. The point of this guard is that nothing else — a
 * timestamp, a Date, a half-typed value from a date input — reaches a
 * DATE column, and that a valid day is never rewritten.
 */
describe('isoDateOrNull', () => {
  it('keeps a calendar date exactly as given', () => {
    expect(isoDateOrNull('2026-08-03')).toBe('2026-08-03');
  });

  it('trims surrounding whitespace', () => {
    expect(isoDateOrNull('  2026-08-03  ')).toBe('2026-08-03');
  });

  it('rejects a timestamp — the day would depend on the reader’s zone', () => {
    expect(isoDateOrNull('2026-08-03T18:30:00.000Z')).toBeNull();
  });

  it('rejects partial input from a half-filled date field', () => {
    expect(isoDateOrNull('2026-08')).toBeNull();
    expect(isoDateOrNull('2026')).toBeNull();
  });

  it('rejects an empty or blank string', () => {
    expect(isoDateOrNull('')).toBeNull();
    expect(isoDateOrNull('   ')).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(isoDateOrNull(null)).toBeNull();
    expect(isoDateOrNull(undefined)).toBeNull();
    expect(isoDateOrNull(new Date('2026-08-03'))).toBeNull();
    expect(isoDateOrNull(20260803)).toBeNull();
  });
});
