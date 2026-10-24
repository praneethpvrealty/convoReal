import { describe, expect, it } from 'vitest';

import {
  JOURNEY_LEAD_INTEREST_LABELS,
  journeyLeadInterestCountLabel,
  journeyLeadInterestLabel,
  mergeJourneyLeadInterest,
  sortCapturedByLeadInterest,
} from './lead-interest-labels';

describe('journey lead interest labels', () => {
  it('[JRN-026] names both kinds of yes a lead can give and nothing for a plain share', () => {
    expect(JOURNEY_LEAD_INTEREST_LABELS).toEqual({
      interested: 'Said interested',
      shortlisted: 'Shortlisted',
    });
    expect(journeyLeadInterestLabel({ lead_interest: 'interested' })).toBe(
      'Said interested'
    );
    expect(journeyLeadInterestLabel({ lead_interest: 'shortlisted' })).toBe(
      'Shortlisted'
    );
    expect(journeyLeadInterestLabel({ lead_interest: null })).toBeNull();
    expect(journeyLeadInterestLabel({})).toBeNull();
  });

  it('[JRN-026] never downgrades Interested to Shortlisted', () => {
    expect(mergeJourneyLeadInterest(null, 'shortlisted')).toBe('shortlisted');
    expect(mergeJourneyLeadInterest('shortlisted', 'interested')).toBe(
      'interested'
    );
    expect(mergeJourneyLeadInterest('interested', 'shortlisted')).toBe(
      'interested'
    );
  });

  it('[JRN-026] lists Interested first, then Shortlisted, newest yes first, then the rest in tray order', () => {
    const items = [
      { id: 'share-1' },
      {
        id: 'short-old',
        lead_interest: 'shortlisted' as const,
        lead_interest_at: '2026-10-20T10:00:00Z',
      },
      {
        id: 'int-old',
        lead_interest: 'interested' as const,
        lead_interest_at: '2026-10-21T10:00:00Z',
      },
      { id: 'share-2' },
      {
        id: 'int-new',
        lead_interest: 'interested' as const,
        lead_interest_at: '2026-10-24T10:00:00Z',
      },
      {
        id: 'short-new',
        lead_interest: 'shortlisted' as const,
        lead_interest_at: '2026-10-23T10:00:00Z',
      },
    ];
    expect(sortCapturedByLeadInterest(items).map((item) => item.id)).toEqual([
      'int-new',
      'int-old',
      'short-new',
      'short-old',
      'share-1',
      'share-2',
    ]);
    expect(items.map((item) => item.id)[0]).toBe('share-1');
  });

  it('[JRN-026] counts the yeses on a journey row and hides the chip at zero', () => {
    expect(journeyLeadInterestCountLabel(0)).toBeNull();
    expect(journeyLeadInterestCountLabel(1)).toBe('1 interested');
    expect(journeyLeadInterestCountLabel(3)).toBe('3 interested');
  });
});
