import { describe, expect, it } from 'vitest';
import {
  boundaryHasPassed,
  istDateKey,
  istMinutesOfDay,
  sweepWindow,
} from './window';

/** 2026-08-20 05:30 UTC is 11:00 IST on the 20th. */
const MORNING = new Date('2026-08-20T05:30:00.000Z');

describe('istDateKey', () => {
  it('rolls the date forward for instants after 18:30 UTC', () => {
    expect(istDateKey(new Date('2026-08-20T18:29:00.000Z'))).toBe('2026-08-20');
    expect(istDateKey(new Date('2026-08-20T18:31:00.000Z'))).toBe('2026-08-21');
  });
});

describe('istMinutesOfDay', () => {
  it('reads midnight IST as zero', () => {
    expect(istMinutesOfDay(new Date('2026-08-19T18:30:00.000Z'))).toBe(0);
  });

  it('reads the 06:00 boundary as 360', () => {
    expect(istMinutesOfDay(new Date('2026-08-20T00:30:00.000Z'))).toBe(360);
  });
});

describe('sweepWindow', () => {
  it('ends at the most recent 06:00 IST boundary', () => {
    const window = sweepWindow(MORNING);
    expect(window.end.toISOString()).toBe('2026-08-20T00:30:00.000Z');
    expect(window.runDate).toBe('2026-08-20');
  });

  it('covers exactly twenty-four hours', () => {
    const window = sweepWindow(MORNING);
    expect(window.end.getTime() - window.start.getTime()).toBe(24 * 3_600_000);
  });

  it('falls back to yesterday before the boundary passes', () => {
    // 04:00 IST on the 20th — this morning's boundary has not arrived.
    const window = sweepWindow(new Date('2026-08-19T22:30:00.000Z'));
    expect(window.end.toISOString()).toBe('2026-08-19T00:30:00.000Z');
    expect(window.runDate).toBe('2026-08-19');
  });

  it('gives the same window to every run of one morning', () => {
    // The idempotence the ledger alone would not provide: a 06:02 cron
    // tick and a 06:41 retry must read the same messages, or the retry
    // could raise a gap the first run missed only because time moved.
    const early = sweepWindow(new Date('2026-08-20T00:32:00.000Z'));
    const late = sweepWindow(new Date('2026-08-20T01:11:00.000Z'));
    expect(early.start.toISOString()).toBe(late.start.toISOString());
    expect(early.end.toISOString()).toBe(late.end.toISOString());
    expect(early.runDate).toBe(late.runDate);
  });

  it('is unaffected by seconds and milliseconds', () => {
    const clean = sweepWindow(new Date('2026-08-20T05:30:00.000Z'));
    const messy = sweepWindow(new Date('2026-08-20T05:30:47.913Z'));
    expect(clean.end.toISOString()).toBe(messy.end.toISOString());
  });
});

describe('boundaryHasPassed', () => {
  it('is false before 06:00 IST and true after', () => {
    expect(boundaryHasPassed(new Date('2026-08-19T22:30:00.000Z'))).toBe(false);
    expect(boundaryHasPassed(new Date('2026-08-20T00:30:00.000Z'))).toBe(true);
    expect(boundaryHasPassed(MORNING)).toBe(true);
  });
});
