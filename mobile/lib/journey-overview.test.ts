import { describe, expect, it } from 'vitest';

import {
  DEFAULT_JOURNEY_SORT,
  focusBuckets,
  journeyEnquiryEntries,
  journeyEnquiryLabel,
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
  const enquiryRows = [
    {
      id: 'old',
      inquiry_source: 'Housing',
      inquiry_date: '2026-01-02T00:00:00Z',
      created_at: '2026-03-01T00:00:00Z',
      property: {
        id: 'p1',
        title: 'Villa 12',
        property_code: 'PROP-12',
        location: 'Whitefield',
      },
      contact: { id: 'c1', name: 'Supreeth', phone: '+917022217893' },
    },
    {
      id: 'new',
      inquiry_source: null,
      inquiry_date: null,
      created_at: '2026-02-01T00:00:00Z',
      property: null,
      contact: null,
    },
  ];

  it('[JRN-012] lists the enquired properties newest first and links each one', () => {
    expect(journeyEnquiryEntries(enquiryRows, 'buyer')).toEqual([
      {
        id: 'new',
        targetId: null,
        title: 'Unknown property',
        subtitle: '',
        source: null,
        enquiredAt: '2026-02-01T00:00:00Z',
      },
      {
        id: 'old',
        targetId: 'p1',
        title: 'Villa 12',
        subtitle: 'PROP-12 · Whitefield',
        source: 'Housing',
        enquiredAt: '2026-01-02T00:00:00Z',
      },
    ]);
  });

  it('[JRN-012] lists the enquiring buyers on a property journey', () => {
    expect(journeyEnquiryEntries(enquiryRows, 'property')[1]).toMatchObject({
      targetId: 'c1',
      title: 'Supreeth',
      subtitle: '+917022217893',
    });
  });

  it('[JRN-012] labels the enquiry count and hides it when there is none', () => {
    expect(journeyEnquiryLabel(0)).toBeNull();
    expect(journeyEnquiryLabel(1)).toBe('1 enquiry');
    expect(journeyEnquiryLabel(19)).toBe('19 enquiries');
  });
});
