import { describe, expect, it } from 'vitest';

import {
  matchesJourneySearch,
  parseJourneyStateMutation,
} from './overview-state';

describe('matchesJourneySearch', () => {
  it('[JRN-001] finds journeys by names, labels and normalized mobile numbers', () => {
    const values = ['Anita Rao', '+91 98765 43210', 'NRI buyer'];
    expect(matchesJourneySearch(values, 'anita')).toBe(true);
    expect(matchesJourneySearch(values, '987654')).toBe(true);
    expect(matchesJourneySearch(values, 'nri')).toBe(true);
    expect(matchesJourneySearch(values, 'commercial')).toBe(false);
  });
});

describe('parseJourneyStateMutation', () => {
  it('[JRN-002] accepts a classified journey closure', () => {
    expect(
      parseJourneyStateMutation({
        action: 'close',
        mode: 'buyer',
        subjectId: 'buyer-1',
        status: 'paused',
        reason: ' Requirement on hold ',
      })
    ).toEqual({
      ok: true,
      value: {
        action: 'close',
        mode: 'buyer',
        subjectId: 'buyer-1',
        status: 'paused',
        reason: 'Requirement on hold',
      },
    });
  });

  it('[JRN-002] requires a reason so closed journeys stay retrievable by context', () => {
    expect(
      parseJourneyStateMutation({
        action: 'close',
        mode: 'buyer',
        subjectId: 'buyer-1',
        status: 'not_proceeding',
        reason: ' ',
      })
    ).toEqual({ ok: false, error: 'Closure reason is required' });
  });

  it('[JRN-003] rejects duplicate subjects in a reorder batch', () => {
    expect(
      parseJourneyStateMutation({
        action: 'reorder',
        mode: 'property',
        subjectIds: ['property-1', 'property-1'],
      })
    ).toEqual({ ok: false, error: 'Invalid journey order' });
  });
});
