import { describe, expect, it } from 'vitest';

import {
  dealsHref,
  legacyJourneyHref,
  legacyPipelinesHref,
  parseDealsView,
} from './routes';

describe('[TXW-017] one Deals surface with three views', () => {
  it('defaults an unknown view to the board', () => {
    expect(parseDealsView(null)).toBe('board');
    expect(parseDealsView('journey')).toBe('journey');
    expect(parseDealsView('records')).toBe('records');
    expect(parseDealsView('pipelines')).toBe('board');
  });

  it('builds a Deals link with only the params that carry a value', () => {
    expect(dealsHref('board')).toBe('/deals?view=board');
    expect(dealsHref('journey', { contact: 'c1', property: null })).toBe(
      '/deals?view=journey&contact=c1'
    );
  });

  it('carries every old journey link across, including the properties mode', () => {
    expect(legacyJourneyHref(new URLSearchParams(''))).toBe(
      '/deals?view=journey'
    );
    expect(legacyJourneyHref(new URLSearchParams('contact=c1'))).toBe(
      '/deals?view=journey&contact=c1'
    );
    expect(legacyJourneyHref(new URLSearchParams('view=properties'))).toBe(
      '/deals?view=journey&journeys=properties'
    );
    expect(legacyJourneyHref(new URLSearchParams('item=j1'))).toBe(
      '/deals?view=journey&item=j1'
    );
  });

  it('carries the old pipeline deep links across', () => {
    expect(legacyPipelinesHref(new URLSearchParams('new=true'))).toBe(
      '/deals?view=board&new=true'
    );
    expect(legacyPipelinesHref(new URLSearchParams('dealId=d1'))).toBe(
      '/deals?view=board&dealId=d1'
    );
  });
});
