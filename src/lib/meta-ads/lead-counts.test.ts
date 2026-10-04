import { describe, it, expect } from 'vitest';
import { countDistinctContactsByAd } from './lead-counts';

describe('countDistinctContactsByAd', () => {
  it('[PRP-029] counts one contact who tapped the same ad twice once', () => {
    const counts = countDistinctContactsByAd([
      { source_id: 'ad-1', contact_id: 'c-1' },
      { source_id: 'ad-1', contact_id: 'c-1' },
      { source_id: 'ad-1', contact_id: 'c-2' },
    ]);
    expect(counts.get('ad-1')).toBe(2);
  });

  it('counts the same contact separately under different ads', () => {
    const counts = countDistinctContactsByAd([
      { source_id: 'ad-1', contact_id: 'c-1' },
      { source_id: 'ad-2', contact_id: 'c-1' },
    ]);
    expect(counts.get('ad-1')).toBe(1);
    expect(counts.get('ad-2')).toBe(1);
  });

  it('ignores rows without an ad or a contact', () => {
    const counts = countDistinctContactsByAd([
      { source_id: null, contact_id: 'c-1' },
      { source_id: 'ad-1', contact_id: null },
    ]);
    expect(counts.size).toBe(0);
  });

  it('returns an empty map for no rows', () => {
    expect(countDistinctContactsByAd([]).size).toBe(0);
  });
});
