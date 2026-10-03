import { describe, expect, it } from 'vitest';

import { isStaleRequest, requestBadge, summarizeRequests } from './requests';

describe('request age badge', () => {
  it('[TXW-020] shows the age in days for a request that waited 72 hours and is not urgent', () => {
    expect(requestBadge({ urgency: 'soon', ageHours: 72 })).toEqual({
      label: '3 d',
      urgency: 'later',
    });
    expect(requestBadge({ urgency: 'later', ageHours: 1950 })).toEqual({
      label: '81 d',
      urgency: 'later',
    });
  });

  it('keeps the urgency label under 72 hours and for a request needing an answer now', () => {
    expect(requestBadge({ urgency: 'soon', ageHours: 71 })).toEqual({
      label: 'Soon',
      urgency: 'soon',
    });
    expect(requestBadge({ urgency: 'now', ageHours: 500 })).toEqual({
      label: 'Now',
      urgency: 'now',
    });
    expect(isStaleRequest({ urgency: 'now', ageHours: 500 })).toBe(false);
  });

  it('headlines the requests needing an answer now and counts the stale ones', () => {
    expect(
      summarizeRequests([
        { urgency: 'now', ageHours: 10 },
        { urgency: 'soon', ageHours: 80 },
        { urgency: 'later', ageHours: 5 },
      ])
    ).toEqual({
      now: 1,
      stale: 1,
      total: 3,
      summary:
        '1 needing an answer now · 3 open in total · 1 waiting over 3 days',
    });
    expect(summarizeRequests([{ urgency: 'now', ageHours: 5 }]).summary).toBe(
      '1 needing an answer now · 1 open in total'
    );
    expect(summarizeRequests([]).summary).toBe('');
  });
});
