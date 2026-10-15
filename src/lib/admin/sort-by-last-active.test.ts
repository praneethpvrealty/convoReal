import { describe, expect, it } from 'vitest';
import { nextLastActiveSort, sortByLastActive } from './sort-by-last-active';

const rows = [
  { id: 'old', last_active_at: '2026-08-01T00:00:00Z' },
  { id: 'unavailable' },
  { id: 'never', last_active_at: null },
  { id: 'recent', last_active_at: '2026-10-14T07:00:00Z' },
];

const ids = (list: { id: string }[]) => list.map((r) => r.id);

describe('sortByLastActive', () => {
  it('keeps the server order when unsorted', () => {
    expect(ids(sortByLastActive(rows, null))).toEqual([
      'old',
      'unavailable',
      'never',
      'recent',
    ]);
  });

  it('lists the most recently active first, never-active and unavailable last', () => {
    expect(ids(sortByLastActive(rows, 'desc'))).toEqual([
      'recent',
      'old',
      'never',
      'unavailable',
    ]);
  });

  it('lists the stalest first, never-active ahead of any date and unavailable last', () => {
    expect(ids(sortByLastActive(rows, 'asc'))).toEqual([
      'never',
      'old',
      'recent',
      'unavailable',
    ]);
  });

  it('does not reorder the array it is given', () => {
    sortByLastActive(rows, 'desc');
    expect(ids(rows)).toEqual(['old', 'unavailable', 'never', 'recent']);
  });
});

describe('nextLastActiveSort', () => {
  it('cycles newest first, oldest first, then off', () => {
    expect(nextLastActiveSort(null)).toBe('desc');
    expect(nextLastActiveSort('desc')).toBe('asc');
    expect(nextLastActiveSort('asc')).toBeNull();
  });
});
