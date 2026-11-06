import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EVENT_DURATION_MS,
  END_BEFORE_START_ERROR,
  INVALID_EVENT_TIME_ERROR,
  MIN_EVENT_DURATION_MS,
  eventDurationMs,
  eventTimesError,
  movedEventEnd,
  startsInPast,
} from './event-timing';

describe('[UIX-010] moving an event keeps its length', () => {
  it('keeps the original duration when the start moves', () => {
    const end = movedEventEnd(
      '2026-11-02T10:00:00.000Z',
      '2026-11-02T12:30:00.000Z',
      new Date('2026-11-05T09:00:00.000Z')
    );
    expect(end.toISOString()).toBe('2026-11-05T11:30:00.000Z');
  });

  it('falls back to one hour when the event has no end', () => {
    expect(eventDurationMs('2026-11-02T10:00:00.000Z', null)).toBe(
      DEFAULT_EVENT_DURATION_MS
    );
    expect(eventDurationMs('2026-11-02T10:00:00.000Z', 'not a date')).toBe(
      DEFAULT_EVENT_DURATION_MS
    );
  });

  it('never shrinks an event below fifteen minutes', () => {
    expect(
      eventDurationMs('2026-11-02T10:00:00.000Z', '2026-11-02T09:00:00.000Z')
    ).toBe(MIN_EVENT_DURATION_MS);
  });
});

describe('[UIX-010] a start time in the past is flagged before saving', () => {
  const now = new Date('2026-11-02T10:00:00.000Z');

  it('flags a start more than a minute before now', () => {
    expect(startsInPast(new Date('2026-11-02T09:58:00.000Z'), now)).toBe(true);
  });

  it('does not flag a start picked as now or later', () => {
    expect(startsInPast(new Date('2026-11-02T09:59:30.000Z'), now)).toBe(false);
    expect(startsInPast(new Date('2026-11-02T11:00:00.000Z'), now)).toBe(false);
  });
});

describe('[UIX-050] an event must end after it starts', () => {
  const start = new Date('2026-11-05T09:00:00.000Z');

  it('accepts an end after the start', () => {
    expect(
      eventTimesError(start, new Date('2026-11-05T09:15:00.000Z'))
    ).toBeNull();
  });

  it('refuses an end equal to or before the start', () => {
    expect(eventTimesError(start, new Date(start))).toBe(
      END_BEFORE_START_ERROR
    );
    expect(eventTimesError(start, new Date('2026-11-05T08:00:00.000Z'))).toBe(
      END_BEFORE_START_ERROR
    );
  });

  it('refuses an unparseable time', () => {
    expect(eventTimesError(new Date('nope'), start)).toBe(
      INVALID_EVENT_TIME_ERROR
    );
  });

  it('keeps the duration when the start moves so the end stays after it', () => {
    const end = movedEventEnd(
      '2026-11-05T09:00:00.000Z',
      '2026-11-05T10:30:00.000Z',
      new Date('2026-11-05T15:00:00.000Z')
    );
    expect(end.toISOString()).toBe('2026-11-05T16:30:00.000Z');
    expect(
      eventTimesError(new Date('2026-11-05T15:00:00.000Z'), end)
    ).toBeNull();
  });
});
