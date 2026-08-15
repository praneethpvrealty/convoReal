import { describe, expect, it } from 'vitest';

import {
  OCCASIONS,
  daysUntil,
  nextOccurrence,
  occasionById,
  upcomingOccasions,
} from './occasions';

describe('occasions catalog', () => {
  it('keeps ids unique', () => {
    const ids = OCCASIONS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every occasion either a recurring day or dated years', () => {
    for (const occasion of OCCASIONS) {
      expect(
        Boolean(occasion.monthDay) ||
          Object.keys(occasion.dates ?? {}).length > 0,
        occasion.id
      ).toBe(true);
    }
  });

  it('looks up occasions by id', () => {
    expect(occasionById('diwali')?.label).toBe('Diwali');
    expect(occasionById('nope')).toBeUndefined();
  });
});

describe('nextOccurrence', () => {
  it('returns the same day when the occasion is today', () => {
    const independence = occasionById('independence_day')!;
    const date = nextOccurrence(independence, new Date(2026, 7, 15, 18, 30));
    expect(date).toEqual(new Date(2026, 7, 15));
  });

  it('rolls a passed fixed date into the next year', () => {
    const newYear = occasionById('new_year')!;
    expect(nextOccurrence(newYear, new Date(2026, 11, 26))).toEqual(
      new Date(2027, 0, 1)
    );
  });

  it('picks the earliest future dated year for lunar festivals', () => {
    const ganesh = occasionById('ganesh_chaturthi')!;
    expect(nextOccurrence(ganesh, new Date(2026, 7, 15))).toEqual(
      new Date(2026, 8, 14)
    );
    expect(nextOccurrence(ganesh, new Date(2026, 9, 1))).toEqual(
      new Date(2027, 8, 4)
    );
  });

  it('returns null when no dated year remains', () => {
    const dussehra = occasionById('dussehra')!;
    expect(nextOccurrence(dussehra, new Date(2030, 0, 1))).toBeNull();
  });
});

describe('upcomingOccasions', () => {
  it('sorts by date and respects the horizon', () => {
    const upcoming = upcomingOccasions(new Date(2026, 7, 16), 60);
    const ids = upcoming.map((u) => u.occasion.id);
    expect(ids).toEqual(['onam', 'raksha_bandhan', 'ganesh_chaturthi']);
    const times = upcoming.map((u) => u.date.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('includes fixed-date occasions across a year boundary', () => {
    const ids = upcomingOccasions(new Date(2026, 11, 20), 40).map(
      (u) => u.occasion.id
    );
    expect(ids).toEqual([
      'christmas',
      'new_year',
      'makar_sankranti',
      'republic_day',
    ]);
  });
});

describe('daysUntil', () => {
  it('counts whole days ignoring time of day', () => {
    expect(
      daysUntil(new Date(2026, 8, 14), new Date(2026, 7, 15, 23, 59))
    ).toBe(30);
    expect(daysUntil(new Date(2026, 7, 15), new Date(2026, 7, 15, 9))).toBe(0);
  });
});
