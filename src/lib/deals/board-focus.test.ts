import { describe, expect, it } from 'vitest';

import { boardDeals, isFocusedDeal } from './board-focus';

const focus = {
  buyers: new Set(['buyer-focus']),
  properties: new Set(['property-focus']),
};

const deals = [
  { id: 'a', contact_id: 'buyer-focus', property_id: 'p1' },
  { id: 'b', contact_id: 'buyer-passive', property_id: 'property-focus' },
  { id: 'c', contact_id: 'buyer-passive', property_id: 'p2' },
  { id: 'd', contact_id: null, property_id: null },
];

describe('[TXW-026] the Board shows Focus journeys by default', () => {
  it('keeps a deal whose buyer or listing journey is in Focus', () => {
    expect(isFocusedDeal(deals[0], focus)).toBe(true);
    expect(isFocusedDeal(deals[1], focus)).toBe(true);
  });

  it('leaves out Passive journeys and deals with no journey', () => {
    expect(isFocusedDeal(deals[2], focus)).toBe(false);
    expect(isFocusedDeal(deals[3], focus)).toBe(false);
    expect(boardDeals(deals, 'focus', focus).map((d) => d.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('shows every deal under All, and while Focus has not loaded', () => {
    expect(boardDeals(deals, 'all', focus)).toHaveLength(4);
    expect(boardDeals(deals, 'focus', null)).toHaveLength(4);
  });
});
