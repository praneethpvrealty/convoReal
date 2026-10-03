import { describe, expect, it } from 'vitest';

import {
  MONTH_CELL_VISIBLE_ITEMS,
  foldCellItems,
  moreLabel,
} from './month-cell';

describe('a month cell folds its overflow behind +N more', () => {
  it('shows every item when the day fits', () => {
    expect(foldCellItems(['a', 'b'])).toEqual({
      shown: ['a', 'b'],
      hiddenCount: 0,
    });
    expect(foldCellItems([])).toEqual({ shown: [], hiddenCount: 0 });
  });

  it('keeps the first items and counts the rest', () => {
    expect(MONTH_CELL_VISIBLE_ITEMS).toBe(2);
    expect(foldCellItems(['a', 'b', 'c', 'd'])).toEqual({
      shown: ['a', 'b'],
      hiddenCount: 2,
    });
    expect(foldCellItems(['a', 'b', 'c'], 1)).toEqual({
      shown: ['a'],
      hiddenCount: 2,
    });
  });

  it('labels the fold', () => {
    expect(moreLabel(1)).toBe('+1 more');
    expect(moreLabel(12)).toBe('+12 more');
  });
});
