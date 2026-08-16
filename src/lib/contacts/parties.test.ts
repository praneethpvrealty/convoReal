import { describe, expect, it } from 'vitest';

import {
  collapseToParties,
  partyDisplayName,
  partyLastTouch,
  type ContactParty,
} from './parties';

// A husband and wife were both carded as quiet on the same listing,
// 28 days and 19 days, because silence is measured per WhatsApp thread
// and a reply from one never reset the other's clock. These pin the two
// rules that fix it: one row per deal, and one clock per party.

const party = (over: Partial<ContactParty> = {}): ContactParty => ({
  id: 'p-1',
  name: null,
  kind: 'household',
  primaryContactId: 'ravi',
  memberIds: ['ravi', 'pruthvi'],
  ...over,
});

const index = (p: ContactParty) =>
  new Map(p.memberIds.map((id) => [id, p] as const));

describe('collapseToParties', () => {
  const rows = [
    { contactId: 'ravi', property: 'jp-nagar' },
    { contactId: 'pruthvi', property: 'jp-nagar' },
  ];

  it('collapses a couple on one deal to a single row', () => {
    const out = collapseToParties(rows, (r) => r.contactId, index(party()));
    expect(out).toHaveLength(1);
    expect(out[0].row.contactId).toBe('ravi');
    expect(out[0].alsoInvolved.map((r) => r.contactId)).toEqual(['pruthvi']);
  });

  it('addresses the primary member, whatever the input order', () => {
    const out = collapseToParties(
      [...rows].reverse(),
      (r) => r.contactId,
      index(party({ primaryContactId: 'pruthvi' }))
    );
    expect(out[0].row.contactId).toBe('pruthvi');
  });

  // A party is never dropped just because the person we normally
  // address is not the one who triggered the card.
  it('falls back to whoever is present when the primary has no row', () => {
    const out = collapseToParties(
      [{ contactId: 'pruthvi', property: 'jp-nagar' }],
      (r) => r.contactId,
      index(party({ primaryContactId: 'ravi' }))
    );
    expect(out).toHaveLength(1);
    expect(out[0].row.contactId).toBe('pruthvi');
  });

  it('leaves a contact who buys alone completely untouched', () => {
    const out = collapseToParties(
      [{ contactId: 'solo', property: 'x' }],
      (r) => r.contactId,
      new Map()
    );
    expect(out).toEqual([
      {
        row: { contactId: 'solo', property: 'x' },
        party: null,
        alsoInvolved: [],
      },
    ]);
  });

  // The couple closing on one flat while still buying another are two
  // deals, however many people sign each.
  it('keeps a party’s two properties as two rows when scoped', () => {
    const out = collapseToParties(
      [
        { contactId: 'ravi', property: 'jp-nagar' },
        { contactId: 'pruthvi', property: 'jp-nagar' },
        { contactId: 'pruthvi', property: 'whitefield' },
      ],
      (r) => r.contactId,
      index(party()),
      (r) => r.property
    );
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.row.property).sort()).toEqual([
      'jp-nagar',
      'whitefield',
    ]);
  });

  it('ignores the scope when the caller does not pass one', () => {
    const out = collapseToParties(
      [
        { contactId: 'ravi', property: 'jp-nagar' },
        { contactId: 'pruthvi', property: 'whitefield' },
      ],
      (r) => r.contactId,
      index(party())
    );
    expect(out).toHaveLength(1);
  });

  it('does not merge two different parties', () => {
    const a = party();
    const b = party({
      id: 'p-2',
      primaryContactId: 'hari',
      memberIds: ['hari'],
    });
    const parties = new Map([...index(a), ...index(b)]);
    const out = collapseToParties(
      [
        { contactId: 'ravi', property: 'x' },
        { contactId: 'hari', property: 'x' },
      ],
      (r) => r.contactId,
      parties
    );
    expect(out).toHaveLength(2);
  });
});

describe('partyLastTouch', () => {
  it('takes the most recent member, so one reply covers the party', () => {
    expect(
      partyLastTouch(['2026-08-01T00:00:00Z', '2026-08-15T00:00:00Z'])
    ).toBe(new Date('2026-08-15T00:00:00Z').getTime());
  });

  it('skips members it holds no timestamp for', () => {
    expect(partyLastTouch([null, '2026-08-15T00:00:00Z'])).toBe(
      new Date('2026-08-15T00:00:00Z').getTime()
    );
  });

  it('returns null when nobody has a usable timestamp', () => {
    expect(
      partyLastTouch([null, undefined as unknown as null, 'nonsense'])
    ).toBeNull();
  });
});

describe('partyDisplayName', () => {
  it('joins two members, which is how an agent recognises the deal', () => {
    expect(partyDisplayName(party(), ['Dr Ravi N', 'Dr Pruthvi'])).toBe(
      'Dr Ravi N & Dr Pruthvi'
    );
  });

  it('prefers a label somebody set', () => {
    expect(
      partyDisplayName(party({ name: 'Nandini Hotel partners' }), ['A', 'B'])
    ).toBe('Nandini Hotel partners');
  });

  it('degrades to a count rather than filling the card with a roster', () => {
    expect(partyDisplayName(party(), ['A', 'B', 'C', 'D'])).toBe(
      'A & 3 others'
    );
  });

  it('is null for a contact who buys alone', () => {
    expect(partyDisplayName(null, ['A'])).toBeNull();
  });

  it('survives members with no name on file', () => {
    expect(partyDisplayName(party(), ['', ''])).toBeNull();
    expect(partyDisplayName(party(), ['Dr Ravi N', ''])).toBe('Dr Ravi N');
  });
});
