import { describe, it, expect } from 'vitest';
import {
  orderPair,
  pairKey,
  pairsWithin,
  isGroupDismissed,
} from '@/lib/contacts/duplicate-dismissal';

describe('orderPair', () => {
  it('reads the same decision either way round', () => {
    expect(orderPair('b', 'a')).toEqual(['a', 'b']);
    expect(pairKey('b', 'a')).toBe(pairKey('a', 'b'));
  });
});

describe('pairsWithin', () => {
  it('covers every pairing in the group', () => {
    expect(pairsWithin(['a', 'b', 'c'])).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ]);
  });
});

describe('isGroupDismissed', () => {
  const dismissed = (...keys: string[]) => new Set(keys);

  it('hides a pair once it has been ruled out', () => {
    expect(isGroupDismissed(['a', 'b'], dismissed('a:b'))).toBe(true);
  });

  it('keeps showing a pair nobody has ruled on', () => {
    expect(isGroupDismissed(['a', 'b'], dismissed())).toBe(false);
  });

  // The reason dismissals are stored per pair. A third contact is new
  // information, and the decision taken about the first two says nothing
  // about it — so the group comes back rather than swallowing it.
  it('brings the group back when a new member joins a settled pair', () => {
    expect(isGroupDismissed(['a', 'b', 'c'], dismissed('a:b'))).toBe(false);
  });

  it('hides the larger group only once every pairing is ruled out', () => {
    expect(
      isGroupDismissed(['a', 'b', 'c'], dismissed('a:b', 'a:c', 'b:c')),
    ).toBe(true);
  });

  it('never treats a single contact as a dismissed group', () => {
    expect(isGroupDismissed(['a'], dismissed('a:b'))).toBe(false);
  });
});
