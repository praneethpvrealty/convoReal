import { describe, expect, it } from 'vitest';

import {
  JOURNEY_PRIORITY_LABELS,
  JOURNEY_PRIORITY_ORDER,
  JOURNEY_REASON_MAX_LENGTH,
  JOURNEY_SORT_LABELS,
  QUICK_DROP_REASONS,
  isJourneyPriority,
  priorityRank,
  sortJourneys,
  type JourneyPriority,
} from './sort';

const j = (
  id: string,
  priority: JourneyPriority | null,
  furthestStageIdx: number,
  lastUpdated: string,
  sortOrder?: number
) => ({
  id,
  priority,
  furthestStageIdx,
  lastUpdated,
  enquiryCount: 0,
  lastEnquiredAt: null,
  sortOrder,
});

describe('[UIX-008] one journey priority ladder and sort set for web and mobile', () => {
  it('labels priorities in one casing and ranks unrated journeys last', () => {
    expect(
      JOURNEY_PRIORITY_ORDER.map((p) => JOURNEY_PRIORITY_LABELS[p])
    ).toEqual(['High', 'Medium', 'Low']);
    expect(JOURNEY_PRIORITY_ORDER.map(priorityRank)).toEqual([0, 1, 2]);
    expect(priorityRank(null)).toBe(3);
  });

  it('accepts only the three stored priorities', () => {
    expect(isJourneyPriority('high')).toBe(true);
    expect(isJourneyPriority('low')).toBe(true);
    expect(isJourneyPriority('urgent')).toBe(false);
    expect(isJourneyPriority(null)).toBe(false);
  });

  it('offers six sorts with the web labels', () => {
    expect(JOURNEY_SORT_LABELS).toEqual({
      enquiries: 'Most enquired',
      enquired: 'Recently enquired',
      manual: 'Manual order',
      priority: 'Priority',
      recent: 'Recent activity',
      stage: 'Furthest stage',
    });
  });

  it('breaks ties by priority, then stage, then recency', () => {
    const input = [
      j('low-far', 'low', 4, '2026-01-01', 1),
      j('high-near', 'high', 1, '2026-01-02', 1),
      j('high-far', 'high', 4, '2026-01-01', 1),
      j('unrated', null, 4, '2026-01-01', 0),
    ];
    expect(sortJourneys(input, 'manual').map((x) => x.id)).toEqual([
      'unrated',
      'high-far',
      'high-near',
      'low-far',
    ]);
    expect(sortJourneys(input, 'stage').map((x) => x.id)).toEqual([
      'high-far',
      'low-far',
      'unrated',
      'high-near',
    ]);
    expect(sortJourneys(input, 'recent').map((x) => x.id)).toEqual([
      'high-near',
      'high-far',
      'low-far',
      'unrated',
    ]);
  });

  it('keeps the drop reasons and the 500-character reason cap', () => {
    expect(QUICK_DROP_REASONS).toContain('Budget mismatch');
    expect(QUICK_DROP_REASONS).toHaveLength(7);
    expect(JOURNEY_REASON_MAX_LENGTH).toBe(500);
  });
});
