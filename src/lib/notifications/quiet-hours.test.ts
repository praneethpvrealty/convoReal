import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUIET_PERIODS,
  quietPeriodStatus,
} from '@/lib/notifications/quiet-hours';

describe('quietPeriodStatus', () => {
  it('holds client reminders overnight and releases them at 8 AM IST', () => {
    const result = quietPeriodStatus(
      new Date('2026-08-18T17:00:00.000Z'),
      DEFAULT_QUIET_PERIODS.client
    );

    expect(result.isQuiet).toBe(true);
    expect(result.deliverAt?.toISOString()).toBe('2026-08-19T02:30:00.000Z');
  });

  it('holds agent reminders before 7 AM IST', () => {
    const result = quietPeriodStatus(
      new Date('2026-08-18T00:30:00.000Z'),
      DEFAULT_QUIET_PERIODS.agent
    );

    expect(result.isQuiet).toBe(true);
    expect(result.deliverAt?.toISOString()).toBe('2026-08-18T01:30:00.000Z');
  });

  it('allows delivery outside the configured period', () => {
    expect(
      quietPeriodStatus(
        new Date('2026-08-18T07:30:00.000Z'),
        DEFAULT_QUIET_PERIODS.agent
      )
    ).toEqual({ isQuiet: false, deliverAt: null });
  });

  it('supports daytime periods and disabled periods', () => {
    expect(
      quietPeriodStatus(new Date('2026-08-18T07:30:00.000Z'), {
        enabled: true,
        start: '12:00',
        end: '14:00',
      }).isQuiet
    ).toBe(true);
    expect(
      quietPeriodStatus(new Date('2026-08-18T17:30:00.000Z'), {
        enabled: false,
        start: '22:00',
        end: '07:00',
      }).isQuiet
    ).toBe(false);
  });
});
