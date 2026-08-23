import { describe, expect, it } from 'vitest';

import {
  UNCOMMITTED_QUIET_DAYS,
  isPitchQuiet,
  parseCheckBackDate,
  quietUntilFrom,
} from './pitch-quiet';

const NOW = new Date('2026-08-23T08:30:00.000Z');

describe('parseCheckBackDate', () => {
  it('reads the date a client actually names', () => {
    const d = parseCheckBackDate('By the 5th of September', NOW);
    expect(d?.getMonth()).toBe(8);
    expect(d?.getDate()).toBe(5);
    expect(d?.getFullYear()).toBe(2026);
  });

  it('reads it written the other way round', () => {
    expect(parseCheckBackDate('Sept 5', NOW)?.getDate()).toBe(5);
  });

  it('rolls a date already past into next year', () => {
    const d = parseCheckBackDate('10th January', NOW);
    expect(d?.getFullYear()).toBe(2027);
  });

  it('reads relative answers', () => {
    expect(parseCheckBackDate('call me tomorrow', NOW)?.getDate()).toBe(24);
    expect(parseCheckBackDate('next week please', NOW)?.getDate()).toBe(30);
    expect(parseCheckBackDate('in 10 days', NOW)?.getMonth()).toBe(8);
    expect(parseCheckBackDate('after a month', NOW)?.getMonth()).toBe(8);
  });

  it('refuses to guess from an answer that names nothing', () => {
    expect(parseCheckBackDate('will let you know', NOW)).toBeNull();
    expect(parseCheckBackDate('after we discuss internally', NOW)).toBeNull();
    expect(parseCheckBackDate('', NOW)).toBeNull();
    expect(parseCheckBackDate(null, NOW)).toBeNull();
  });
});

describe('quietUntilFrom', () => {
  it('falls back to a short window when no date was read', () => {
    const until = quietUntilFrom(null, NOW);
    expect(until.getDate()).toBe(30);
    expect(UNCOMMITTED_QUIET_DAYS).toBe(7);
  });

  it('keeps the date the client named', () => {
    const named = parseCheckBackDate('By the 5th of September', NOW)!;
    expect(quietUntilFrom(named, NOW).getDate()).toBe(5);
  });

  it('never holds a lead past the ceiling', () => {
    const far = new Date('2030-01-01T00:00:00.000Z');
    expect(quietUntilFrom(far, NOW).getFullYear()).toBe(2026);
  });

  it('treats a date already gone as no commitment', () => {
    const past = new Date('2026-01-01T00:00:00.000Z');
    expect(quietUntilFrom(past, NOW).getDate()).toBe(30);
  });
});

describe('isPitchQuiet', () => {
  it('holds until the date, then stops holding', () => {
    expect(
      isPitchQuiet({ pitch_quiet_until: '2026-09-05T18:29:59Z' }, NOW)
    ).toBe(true);
    expect(
      isPitchQuiet({ pitch_quiet_until: '2026-08-01T00:00:00Z' }, NOW)
    ).toBe(false);
  });

  it('is silent about a contact who committed to nothing', () => {
    expect(isPitchQuiet({ pitch_quiet_until: null }, NOW)).toBe(false);
    expect(isPitchQuiet({}, NOW)).toBe(false);
  });
});
