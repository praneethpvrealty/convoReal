import { describe, it, expect } from 'vitest';
import { leadCountsByAd } from './lead-counts';

describe('leadCountsByAd', () => {
  it('[PRP-029] maps each ad to the distinct-contact count SQL returned', () => {
    const counts = leadCountsByAd([
      { source_id: 'ad-1', contacts: 2 },
      { source_id: 'ad-2', contacts: 1 },
    ]);
    expect(counts.get('ad-1')).toBe(2);
    expect(counts.get('ad-2')).toBe(1);
  });

  it('reads a bigint count serialised as a string', () => {
    expect(
      leadCountsByAd([{ source_id: 'ad-1', contacts: '7' }]).get('ad-1')
    ).toBe(7);
  });

  it('ignores rows without an ad', () => {
    expect(leadCountsByAd([{ source_id: null, contacts: 3 }]).size).toBe(0);
  });

  it('returns an empty map for no rows', () => {
    expect(leadCountsByAd([]).size).toBe(0);
  });
});
