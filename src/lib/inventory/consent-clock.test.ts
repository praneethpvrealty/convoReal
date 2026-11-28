import { describe, expect, it } from 'vitest';

import { addAwakeTime, consentSchedule } from './consent-clock';

const CLIENT = { enabled: true, start: '21:00', end: '08:00' };
const ist = (iso: string) => new Date(`${iso}+05:30`);

describe('consentSchedule', () => {
  it('[PRP-067] does not run the clock overnight: a 06:08 ask is reminded at 10:00 and closes at 12:00', () => {
    const { remindAt, deadlineAt } = consentSchedule(
      ist('2026-11-17T06:08:00'),
      CLIENT
    );
    expect(remindAt.toISOString()).toBe(
      ist('2026-11-17T10:00:00').toISOString()
    );
    expect(deadlineAt.toISOString()).toBe(
      ist('2026-11-17T12:00:00').toISOString()
    );
  });

  it('gives four daytime hours to an afternoon ask', () => {
    const { remindAt, deadlineAt } = consentSchedule(
      ist('2026-11-17T14:00:00'),
      CLIENT
    );
    expect(remindAt.toISOString()).toBe(
      ist('2026-11-17T16:00:00').toISOString()
    );
    expect(deadlineAt.toISOString()).toBe(
      ist('2026-11-17T18:00:00').toISOString()
    );
  });

  it('carries an evening ask over the night', () => {
    const { remindAt, deadlineAt } = consentSchedule(
      ist('2026-11-17T20:00:00'),
      CLIENT
    );
    expect(remindAt.toISOString()).toBe(
      ist('2026-11-18T09:00:00').toISOString()
    );
    expect(deadlineAt.toISOString()).toBe(
      ist('2026-11-18T11:00:00').toISOString()
    );
  });

  it('[PRP-067] never lands a reminder or deadline on the first minute of quiet hours', () => {
    const { remindAt, deadlineAt } = consentSchedule(
      ist('2026-11-17T17:00:00'),
      CLIENT
    );
    expect(remindAt.toISOString()).toBe(
      ist('2026-11-17T19:00:00').toISOString()
    );
    expect(deadlineAt.toISOString()).toBe(
      ist('2026-11-18T08:00:00').toISOString()
    );
  });

  it('runs on wall-clock time when quiet hours are off', () => {
    const start = ist('2026-11-17T23:00:00');
    expect(
      addAwakeTime(start, 4 * 3600_000, { ...CLIENT, enabled: false })
    ).toEqual(new Date(start.getTime() + 4 * 3600_000));
  });
});
