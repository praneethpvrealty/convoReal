import { describe, expect, it } from 'vitest';
import {
  attentionHint,
  attentionSummary,
  inventoryEmptyState,
  partyCounts,
  tabCount,
  type AttentionCountRow,
  type SourceBreakdownRow,
} from './list-scope';

const rows: SourceBreakdownRow[] = [
  {
    status: 'Available',
    is_published: true,
    agent_referred: false,
    listings: 60,
  },
  {
    status: 'Available',
    is_published: false,
    agent_referred: false,
    listings: 20,
  },
  { status: 'Sold', is_published: true, agent_referred: false, listings: 10 },
  {
    status: 'Under Contract',
    is_published: false,
    agent_referred: false,
    listings: 5,
  },
  {
    status: 'Available',
    is_published: true,
    agent_referred: true,
    listings: 80,
  },
  { status: 'Sold', is_published: false, agent_referred: true, listings: 12 },
  {
    status: 'Under Contract',
    is_published: true,
    agent_referred: true,
    listings: 10,
  },
  {
    status: 'Pending Review',
    is_published: false,
    agent_referred: true,
    listings: 1,
  },
  {
    status: 'Archived',
    is_published: false,
    agent_referred: false,
    listings: 3,
  },
];

describe('partyCounts', () => {
  it('[PRP-026] counts active rows only on All Listings and Direct plus Agent equals All', () => {
    const counts = partyCounts(rows, 'all', 'all');
    expect(counts).toEqual({ All: 198, Owner: 95, Agent: 103 });
    expect(counts.Owner + counts.Agent).toBe(counts.All);
  });

  it('[PRP-026] counts only Pending Review rows on the Review tab', () => {
    expect(partyCounts(rows, 'review', 'all')).toEqual({
      All: 1,
      Owner: 0,
      Agent: 1,
    });
  });

  it('[PRP-026] counts only Archived rows on the Archived tab', () => {
    expect(partyCounts(rows, 'archived', 'all')).toEqual({
      All: 3,
      Owner: 3,
      Agent: 0,
    });
    expect(tabCount(rows, 'archived')).toBe(3);
    expect(tabCount(rows, 'review')).toBe(1);
    expect(tabCount(rows, 'all')).toBe(198);
  });

  it('[PRP-026] narrows the All tab by each summary tile', () => {
    expect(partyCounts(rows, 'all', 'available')).toEqual({
      All: 160,
      Owner: 80,
      Agent: 80,
    });
    expect(partyCounts(rows, 'all', 'closed')).toEqual({
      All: 37,
      Owner: 15,
      Agent: 22,
    });
    expect(partyCounts(rows, 'all', 'showcased')).toEqual({
      All: 160,
      Owner: 70,
      Agent: 90,
    });
  });

  it('[PRP-026] ignores the tile on the review and archived tabs', () => {
    expect(partyCounts(rows, 'review', 'closed')).toEqual(
      partyCounts(rows, 'review', 'all')
    );
    expect(partyCounts(rows, 'archived', 'showcased')).toEqual(
      partyCounts(rows, 'archived', 'all')
    );
  });

  it('[PRP-026] sums listings given as strings from PostgREST bigint numerically', () => {
    const counts = partyCounts(
      [
        {
          status: 'Available',
          is_published: true,
          agent_referred: false,
          listings: '143',
        },
        {
          status: 'Available',
          is_published: true,
          agent_referred: true,
          listings: '102',
        },
      ],
      'all',
      'all'
    );
    expect(counts).toEqual({ All: 245, Owner: 143, Agent: 102 });
  });
});

describe('inventoryEmptyState', () => {
  const base = {
    tab: 'all' as const,
    tile: 'all' as const,
    party: 'All' as const,
    search: '',
    location: null,
  };

  it('[PRP-027] gives each unfiltered tab its own unfiltered copy', () => {
    const review = inventoryEmptyState({ ...base, tab: 'review' });
    const archived = inventoryEmptyState({ ...base, tab: 'archived' });
    const all = inventoryEmptyState(base);
    for (const copy of [review, archived, all]) {
      expect(copy.filtered).toBe(false);
      expect(copy.title).not.toBe('No listings found');
    }
    expect(new Set([review.title, archived.title, all.title]).size).toBe(3);
  });

  it('[PRP-027] reports a filtered empty state for Archived with the Agent party', () => {
    const copy = inventoryEmptyState({
      ...base,
      tab: 'archived',
      party: 'Agent',
    });
    expect(copy.filtered).toBe(true);
    expect(copy.title).toBe('No listings match these filters');
    expect(copy.body).toContain('Archived');
    expect(copy.body).toContain('Agent referred');
  });

  it('[PRP-027] names the search and location filters in the body', () => {
    const copy = inventoryEmptyState({
      ...base,
      search: ' villa ',
      location: 'Whitefield within 5 km',
    });
    expect(copy.filtered).toBe(true);
    expect(copy.body).toContain('villa');
    expect(copy.body).toContain('Whitefield within 5 km');
  });

  it('[PRP-027] names the tile only on the All Listings tab', () => {
    const onAll = inventoryEmptyState({ ...base, tile: 'available' });
    expect(onAll.filtered).toBe(true);
    expect(onAll.body).toContain('Available');
    const onReview = inventoryEmptyState({
      ...base,
      tab: 'review',
      tile: 'available',
    });
    expect(onReview.filtered).toBe(false);
  });
});

const attentionRows: AttentionCountRow[] = [
  {
    agent_referred: false,
    listings: '5',
    no_photos: '3',
    no_price: 1,
    no_pin: 2,
  },
  { agent_referred: true, listings: 2, no_photos: 1, no_price: 0, no_pin: '1' },
];

describe('attention helpers', () => {
  it('[PRP-030] attentionSummary sums string and number rows', () => {
    expect(attentionSummary(attentionRows)).toEqual({
      listings: 7,
      noPhotos: 4,
      noPrice: 1,
      noPin: 3,
    });
    expect(attentionSummary([])).toEqual({
      listings: 0,
      noPhotos: 0,
      noPrice: 0,
      noPin: 0,
    });
  });

  it('[PRP-030] attentionHint lists only the non-zero parts', () => {
    const hint = attentionHint({
      listings: 3,
      noPhotos: 2,
      noPrice: 0,
      noPin: 1,
    });
    expect(hint).toContain('2 without photos');
    expect(hint).toContain('1 without a map pin');
    expect(hint).not.toContain('without a price');
  });

  it('[PRP-030] attentionHint says everything is fine at zero', () => {
    expect(
      attentionHint({ listings: 0, noPhotos: 0, noPrice: 0, noPin: 0 })
    ).toBe('Every available listing has photos, a price and a map pin.');
  });

  it('[PRP-030] partyCounts uses the attention rows on All Listings and Direct plus Agent equals All', () => {
    const counts = partyCounts(rows, 'all', 'attention', attentionRows);
    expect(counts).toEqual({ All: 7, Owner: 5, Agent: 2 });
    expect(counts.Owner + counts.Agent).toBe(counts.All);
  });

  it('[PRP-030] partyCounts ignores the attention rows on the review and archived tabs', () => {
    expect(partyCounts(rows, 'review', 'attention', attentionRows)).toEqual(
      partyCounts(rows, 'review', 'all')
    );
    expect(partyCounts(rows, 'archived', 'attention', attentionRows)).toEqual(
      partyCounts(rows, 'archived', 'all')
    );
  });

  it('[PRP-030] inventoryEmptyState names Needs attention for that tile', () => {
    const copy = inventoryEmptyState({
      tab: 'all',
      tile: 'attention',
      party: 'All',
      search: '',
      location: null,
    });
    expect(copy.filtered).toBe(true);
    expect(copy.body).toContain('Needs attention');
  });
});
