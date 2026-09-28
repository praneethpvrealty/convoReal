import { describe, expect, it } from 'vitest';

import {
  DEFAULT_JOURNEY_SORT,
  focusBuckets,
  journeyEnquiryLabel,
  journeyEnquirySourceOptions,
  matchesJourneyEnquirySource,
  normalizeJourneyEnquirySource,
  normalizeJourneyEnquirySources,
  journeyRaceLabel,
  sortJourneys,
  splitItemsAtStage,
} from './journey-overview';

describe('focusBuckets', () => {
  const buckets = [
    { key: 'stage:new', groups: 91 },
    { key: 'stage:negotiation', groups: 2 },
    { key: 'stage:won', groups: 1 },
  ];

  it('[JRN-006] shows every stage card until one is selected', () => {
    expect(focusBuckets(buckets, null)).toBe(buckets);
  });

  it('[JRN-006] hides the other stage cards while one is selected', () => {
    expect(focusBuckets(buckets, 'stage:negotiation')).toEqual([
      { key: 'stage:negotiation', groups: 2 },
    ]);
  });

  it('[JRN-006] falls back to every stage card when the selected one is gone', () => {
    expect(focusBuckets(buckets, 'closed:completed')).toBe(buckets);
    expect(focusBuckets([], 'stage:new')).toEqual([]);
  });
});

describe('journeyRaceLabel', () => {
  it('[JRN-007] counts what is still in the race and says so plainly at zero', () => {
    expect(journeyRaceLabel(3)).toBe('3 in the race');
    expect(journeyRaceLabel(0)).toBe('Nothing in the race');
  });
});

describe('splitItemsAtStage', () => {
  const rows = [
    { id: 'a', stage_id: 'new', status: 'active' },
    { id: 'b', stage_id: 'token', status: 'active' },
    { id: 'c', stage_id: 'new', status: 'dropped' },
  ];

  it('[JRN-008] leads with the live items on the group stage and folds the rest', () => {
    expect(splitItemsAtStage(rows, 'token')).toEqual({
      atStage: [rows[1]],
      elsewhere: [rows[0], rows[2]],
    });
    expect(splitItemsAtStage(rows, null)).toEqual({
      atStage: rows,
      elsewhere: [],
    });
  });

  it('[JRN-008] leads with the dropped items inside the lost stage group', () => {
    expect(splitItemsAtStage(rows, 'lost', true)).toEqual({
      atStage: [rows[2]],
      elsewhere: [rows[0], rows[1]],
    });
  });
});

describe('sortJourneys', () => {
  const j = (
    id: string,
    enquiryCount: number,
    lastEnquiredAt: string | null,
    lastUpdated = '2026-01-01',
    sortOrder = Number.MAX_SAFE_INTEGER
  ) => ({
    id,
    furthestStageIdx: 0,
    lastUpdated,
    enquiryCount,
    lastEnquiredAt,
    sortOrder,
  });

  const input = [
    j('once-old', 1, '2026-01-01', '2026-01-09', 0),
    j('none-fresh', 0, null, '2026-01-10'),
    j('thrice', 3, '2026-01-02'),
    j('once-new', 1, '2026-01-05'),
  ];

  it('[JRN-012] defaults to the most enquired first, newest enquiry breaking ties', () => {
    expect(DEFAULT_JOURNEY_SORT).toBe('enquiries');
    expect(sortJourneys(input, 'enquiries').map((x) => x.id)).toEqual([
      'thrice',
      'once-new',
      'once-old',
      'none-fresh',
    ]);
  });

  it('[JRN-012] can lead with the most recent enquiry instead', () => {
    expect(sortJourneys(input, 'enquired').map((x) => x.id)).toEqual([
      'once-new',
      'thrice',
      'once-old',
      'none-fresh',
    ]);
  });

  it('[JRN-003] keeps the saved manual order when chosen', () => {
    expect(sortJourneys(input, 'manual')[0].id).toBe('once-old');
  });
});

describe('journeyEnquiryLabel', () => {
  const enquiry = (
    enquiryCount: number,
    lastEnquiredAt: string | null = null,
    lastEnquirySource: string | null = null,
    enquirySourceCount = lastEnquirySource ? 1 : 0
  ) => ({
    enquiryCount,
    lastEnquiredAt,
    lastEnquirySource,
    enquirySourceCount,
  });

  it('[JRN-012] labels the enquiry count and hides it when there is none', () => {
    expect(journeyEnquiryLabel(enquiry(0))).toBeNull();
    expect(journeyEnquiryLabel(enquiry(1))).toBe('1 enquiry');
    expect(journeyEnquiryLabel(enquiry(19))).toBe('19 enquiries');
  });

  it('[JRN-012] adds the last enquiry date, with the year only when it is not this year', () => {
    const now = new Date('2026-09-28T12:00:00Z');
    expect(journeyEnquiryLabel(enquiry(3, '2026-09-12T12:00:00Z'), now)).toBe(
      '3 enquiries · 12 Sep'
    );
    expect(journeyEnquiryLabel(enquiry(1, '2025-12-03T12:00:00Z'), now)).toBe(
      '1 enquiry · 3 Dec 2025'
    );
    expect(journeyEnquiryLabel(enquiry(2, 'not a date'), now)).toBe(
      '2 enquiries'
    );
  });

  it('[JRN-012] names the latest enquiry source, counting any others', () => {
    const now = new Date('2026-09-28T12:00:00Z');
    expect(
      journeyEnquiryLabel(enquiry(3, '2026-09-12T12:00:00Z', 'Housing'), now)
    ).toBe('3 enquiries · Housing · 12 Sep');
    expect(
      journeyEnquiryLabel(
        enquiry(4, '2026-09-12T12:00:00Z', 'Magic Bricks', 3),
        now
      )
    ).toBe('4 enquiries · Magic Bricks +2 · 12 Sep');
    expect(journeyEnquiryLabel(enquiry(1, null, 'Manual'), now)).toBe(
      '1 enquiry · Manual'
    );
  });
});

describe('journey enquiry source filter', () => {
  const g = (id: string, enquirySources: string[]) => ({ id, enquirySources });
  const groups = [
    g('a', ['Housing', 'Manual']),
    g('b', ['Housing']),
    g('c', ['Magic Bricks']),
    g('d', []),
  ];

  it('[JRN-012] offers each source with how many journeys have it, most common first', () => {
    expect(journeyEnquirySourceOptions(groups)).toEqual([
      { source: 'Housing', count: 2 },
      { source: 'Magic Bricks', count: 1 },
      { source: 'Manual', count: 1 },
    ]);
    expect(journeyEnquirySourceOptions([])).toEqual([]);
  });

  it('[JRN-012] keeps a chosen source offered when no journey in view has it', () => {
    expect(journeyEnquirySourceOptions([g('d', [])], '99acres')).toEqual([
      { source: '99acres', count: 0 },
    ]);
  });

  it('[JRN-012] keeps journeys with any enquiry from the chosen source', () => {
    expect(
      groups
        .filter((group) => matchesJourneyEnquirySource(group, 'Housing'))
        .map((group) => group.id)
    ).toEqual(['a', 'b']);
    expect(
      groups.filter((group) => matchesJourneyEnquirySource(group, null))
    ).toHaveLength(4);
  });
  it('[JRN-012] restores only a usable remembered source', () => {
    expect(normalizeJourneyEnquirySource(' Housing ')).toBe('Housing');
    expect(normalizeJourneyEnquirySource('')).toBeNull();
    expect(normalizeJourneyEnquirySource('   ')).toBeNull();
    expect(normalizeJourneyEnquirySource(null)).toBeNull();
    expect(normalizeJourneyEnquirySource(42)).toBeNull();
    expect(normalizeJourneyEnquirySource('x'.repeat(201))).toBeNull();
  });
});

describe('remembered journey enquiry sources', () => {
  it('[JRN-012] keeps one usable source per journey tab from the stored blob', () => {
    expect(
      normalizeJourneyEnquirySources({
        buyer: 'Housing',
        property: '  ',
        other: 'Manual',
      })
    ).toEqual({ buyer: 'Housing' });
    expect(normalizeJourneyEnquirySources(null)).toEqual({});
    expect(normalizeJourneyEnquirySources('Housing')).toEqual({});
    expect(
      normalizeJourneyEnquirySources({ buyer: 7, property: 'Magic Bricks' })
    ).toEqual({ property: 'Magic Bricks' });
  });
});
