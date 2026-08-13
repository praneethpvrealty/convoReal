import { describe, it, expect } from 'vitest';
import { titleTokens, titleSimilarity, istDayKey, findDuplicate } from './event-dedupe';

describe('titleTokens', () => {
  it('drops filler, punctuation and possessives', () => {
    expect(titleTokens("Follow up with Kusumaraju's advocate")).toEqual([
      'follow',
      'up',
      'kusumaraju',
      'advocate',
    ]);
  });

  it('reads an empty title as no tokens', () => {
    expect(titleTokens('')).toEqual([]);
    expect(titleTokens('the a of')).toEqual([]);
  });
});

describe('titleSimilarity', () => {
  it('scores the same job worded twice as the same subject', () => {
    expect(
      titleSimilarity('Follow up with the advocate', "Follow up with Kusumaraju's advocate")
    ).toBeGreaterThanOrEqual(0.67);
  });

  it('keeps different jobs apart', () => {
    expect(titleSimilarity('Call the advocate', 'Call the builder')).toBeLessThan(0.67);
    expect(titleSimilarity('Site visit at JP Nagar', 'Send brochure to Rakesh')).toBe(0);
  });

  it('does not punish the longer telling for carrying more detail', () => {
    // Union-based scoring would sink this; the shorter set is the measure.
    expect(
      titleSimilarity(
        'Follow up with the advocate',
        'Follow up with the advocate about the sale deed draft'
      )
    ).toBe(1);
  });

  it('is zero when either side has nothing to compare', () => {
    expect(titleSimilarity('', 'Call the advocate')).toBe(0);
  });
});

describe('istDayKey', () => {
  it('groups by the Indian calendar day, not UTC', () => {
    // 19:30 UTC is past midnight in India — the next day there.
    expect(istDayKey('2026-08-19T19:30:00.000Z')).toBe('2026-08-20');
    expect(istDayKey('2026-08-20T04:30:00.000Z')).toBe('2026-08-20');
  });
});

describe('findDuplicate', () => {
  const monday10 = '2026-08-17T04:30:00.000Z';
  const monday16 = '2026-08-17T10:30:00.000Z';
  const friday10 = '2026-08-21T04:30:00.000Z';

  it('matches the same subject on the same day', () => {
    const found = findDuplicate({ title: 'Follow up with the advocate', when: monday10 }, [
      { id: 'a', title: "Follow up with Kusumaraju's advocate", when: monday16 },
    ]);
    expect(found?.id).toBe('a');
  });

  it('leaves the same subject on another day alone', () => {
    // Two site visits with one buyer in a week are two visits.
    const found = findDuplicate({ title: 'Site visit with Varun', when: monday10 }, [
      { id: 'a', title: 'Site visit with Varun', when: friday10 },
    ]);
    expect(found).toBeNull();
  });

  it('leaves a different subject on the same day alone', () => {
    const found = findDuplicate({ title: 'Call the advocate', when: monday10 }, [
      { id: 'a', title: 'Call the builder', when: monday16 },
    ]);
    expect(found).toBeNull();
  });

  it('does not merge two events just because they share a contact', () => {
    const found = findDuplicate({ title: 'Site visit at JP Nagar', when: monday10, contactId: 'c1' }, [
      { id: 'a', title: 'Send the brochure', when: monday16, contact_id: 'c1' },
    ]);
    expect(found).toBeNull();
  });

  it('keeps identically-titled events with different people apart', () => {
    // "Site visit" is the title two agents write for two buyers on one
    // afternoon; the wording alone would merge them.
    const found = findDuplicate({ title: 'Site visit', when: monday10, contactId: 'c1' }, [
      { id: 'a', title: 'Site visit', when: monday16, contact_id: 'c2' },
    ]);
    expect(found).toBeNull();
  });

  it('keeps a clashing liaison apart the same way', () => {
    const found = findDuplicate({ title: 'Sale deed meeting', when: monday10, liaisonId: 'l1' }, [
      { id: 'a', title: 'Sale deed meeting', when: monday16, liaison_id: 'l2' },
    ]);
    expect(found).toBeNull();
  });

  it('still matches when only one side names the party', () => {
    // A row created without a resolved contact contradicts nothing.
    const found = findDuplicate({ title: 'Sale deed meeting', when: monday10, contactId: 'c1' }, [
      { id: 'a', title: 'Sale deed meeting', when: monday16, contact_id: null },
    ]);
    expect(found?.id).toBe('a');
  });

  it('pairs undated to-dos only with other undated ones', () => {
    const rows = [{ id: 'a', title: 'Follow up with the advocate', when: null }];
    expect(findDuplicate({ title: 'Follow up with the advocate', when: null }, rows)?.id).toBe('a');
    // Giving the repeat a due date is new information, not a duplicate.
    expect(findDuplicate({ title: 'Follow up with the advocate', when: monday10 }, rows)).toBeNull();
  });

  it('takes the closest wording when several could match', () => {
    // Both contain the query, so both score 1 — the tie breaks toward the
    // restatement rather than the longer entry that merely swallows it.
    const found = findDuplicate({ title: 'Follow up with the advocate', when: monday10 }, [
      { id: 'loose', title: 'Follow up with the advocate about the deed and the khata', when: monday10 },
      { id: 'exact', title: 'Follow up with the advocate', when: monday16 },
    ]);
    expect(found?.id).toBe('exact');
  });

  it('finds nothing in an empty list', () => {
    expect(findDuplicate({ title: 'Anything', when: monday10 }, [])).toBeNull();
  });
});
