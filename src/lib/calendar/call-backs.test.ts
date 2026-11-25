import { describe, expect, it } from 'vitest';

import {
  CALL_BACK_EVENT_TYPE,
  callBackBucket,
  callBackLookbackStart,
  groupCallBacks,
} from './call-backs';
import { EVENT_TYPE_ORDER } from './event-type-defaults';

const now = new Date(2026, 10, 25, 12, 0, 0);
const at = (day: number, hour: number) =>
  new Date(2026, 10, day, hour, 0, 0).toISOString();

describe('call backs', () => {
  it('[CAL-024] buckets a call as overdue, later today or upcoming', () => {
    expect(callBackBucket(at(25, 9), now)).toBe('overdue');
    expect(callBackBucket(at(20, 9), now)).toBe('overdue');
    expect(callBackBucket(at(25, 18), now)).toBe('today');
    expect(callBackBucket(at(26, 9), now)).toBe('upcoming');
  });

  it('[CAL-024] groups overdue first, each group in time order, and drops empty groups', () => {
    const groups = groupCallBacks(
      [
        { id: 'c', start_time: at(27, 9) },
        { id: 'b', start_time: at(25, 8) },
        { id: 'a', start_time: at(24, 8) },
        { id: 'd', start_time: at(26, 9) },
      ],
      now
    );
    expect(groups.map((g) => g.bucket)).toEqual(['overdue', 'upcoming']);
    expect(groups[0].items.map((c) => c.id)).toEqual(['a', 'b']);
    expect(groups[1].items.map((c) => c.id)).toEqual(['d', 'c']);
  });

  it('[CAL-024] looks back thirty days and reads Call events', () => {
    expect(callBackLookbackStart(now)).toBe(
      new Date(now.getTime() - 30 * 86_400_000).toISOString()
    );
    expect(EVENT_TYPE_ORDER).toContain(CALL_BACK_EVENT_TYPE);
  });
});
