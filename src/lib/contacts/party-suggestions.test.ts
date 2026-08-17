import { describe, expect, it } from 'vitest';

import {
  looksLikeDuplicate,
  suggestPartyMembers,
  suggestionPairKey,
  type SuggestionCandidate,
} from './party-suggestions';

// Linking is manual, so it only happens when an agent already knows.
// These read the signals already in the book — and, above all, refuse
// to confuse "buys with" (a link) with "is the same person" (a merge,
// which destroys a record).

const c = (
  id: string,
  over: Partial<SuggestionCandidate> = {}
): SuggestionCandidate => ({
  id,
  name: `Contact ${id}`,
  second_name: null,
  phone: `+9199000000${id}`,
  email: null,
  company: null,
  propertyIds: [],
  ...over,
});

describe('looksLikeDuplicate', () => {
  it('catches a shared phone whatever the formatting', () => {
    expect(
      looksLikeDuplicate(
        c('1', { phone: '+91 99452 33018' }),
        c('2', { phone: '9945233018' })
      )
    ).toBe(true);
  });

  it('catches a shared email', () => {
    expect(
      looksLikeDuplicate(
        c('1', { email: 'Ravi@Example.com' }),
        c('2', { email: 'ravi@example.com' })
      )
    ).toBe(true);
  });

  it('is false for two genuinely different people', () => {
    expect(looksLikeDuplicate(c('1'), c('2'))).toBe(false);
  });

  it('does not treat two blank emails as a match', () => {
    expect(
      looksLikeDuplicate(c('1', { email: '' }), c('2', { email: null }))
    ).toBe(false);
  });
});

describe('suggestPartyMembers', () => {
  it('leads with two people on the same property', () => {
    const out = suggestPartyMembers(c('1', { propertyIds: ['p-1'] }), [
      c('2', { propertyIds: ['p-1'] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      contactId: '2',
      reason: 'same_property',
      detail: 'p-1',
    });
  });

  it('suggests colleagues by company', () => {
    const out = suggestPartyMembers(c('1', { company: 'Acme Realty ' }), [
      c('2', { company: 'acme realty' }),
    ]);
    expect(out[0].reason).toBe('same_company');
  });

  it('suggests a work email domain but never a free one', () => {
    const work = suggestPartyMembers(c('1', { email: 'a@acme.co.in' }), [
      c('2', { email: 'b@acme.co.in' }),
    ]);
    expect(work[0]?.reason).toBe('email_domain');

    const free = suggestPartyMembers(c('1', { email: 'a@gmail.com' }), [
      c('2', { email: 'b@gmail.com' }),
    ]);
    expect(free).toHaveLength(0);
  });

  it('offers a shared surname as the weakest signal', () => {
    const out = suggestPartyMembers(c('1', { second_name: 'Nagaraj' }), [
      c('2', { second_name: 'nagaraj' }),
    ]);
    expect(out[0].reason).toBe('shared_surname');
  });

  // The rule the whole module exists to hold: a shared phone or email
  // is ONE PERSON SAVED TWICE. That is a merge, and merging is
  // destructive — it must never be offered here.
  it('never suggests a pair that is really a duplicate', () => {
    const out = suggestPartyMembers(
      c('1', { phone: '9945233018', company: 'Acme', propertyIds: ['p-1'] }),
      [
        c('2', {
          phone: '+919945233018',
          company: 'Acme',
          propertyIds: ['p-1'],
        }),
      ]
    );
    expect(out).toHaveLength(0);
  });

  it('reports one reason per pair, strongest first', () => {
    const out = suggestPartyMembers(
      c('1', { company: 'Acme', second_name: 'Rao', propertyIds: ['p-1'] }),
      [
        c('2', { second_name: 'Rao' }),
        c('3', { propertyIds: ['p-1'] }),
        c('4', { company: 'Acme' }),
      ]
    );
    expect(out.map((s) => s.reason)).toEqual([
      'same_property',
      'same_company',
      'shared_surname',
    ]);
  });

  // A contact belongs to at most one party, so suggesting someone
  // already spoken for would only produce a refusal at the API.
  it('skips contacts already in a party, and says nothing for a linked subject', () => {
    const linked = new Set(['2']);
    expect(
      suggestPartyMembers(
        c('1', { propertyIds: ['p-1'] }),
        [c('2', { propertyIds: ['p-1'] })],
        linked
      )
    ).toHaveLength(0);
    expect(
      suggestPartyMembers(
        c('1', { propertyIds: ['p-1'] }),
        [c('2', { propertyIds: ['p-1'] })],
        new Set(['1'])
      )
    ).toHaveLength(0);
  });

  it('honours a dismissal whichever way round the pair was stored', () => {
    const dismissed = new Set([suggestionPairKey('2', '1')]);
    expect(
      suggestPartyMembers(
        c('1', { propertyIds: ['p-1'] }),
        [c('2', { propertyIds: ['p-1'] })],
        new Set(),
        dismissed
      )
    ).toHaveLength(0);
  });

  it('never suggests the contact themselves', () => {
    const self = c('1', { propertyIds: ['p-1'] });
    expect(suggestPartyMembers(self, [self])).toHaveLength(0);
  });

  it('says nothing when there is no signal at all', () => {
    expect(suggestPartyMembers(c('1'), [c('2'), c('3')])).toHaveLength(0);
  });
});

describe('suggestionPairKey', () => {
  it('is order-independent', () => {
    expect(suggestionPairKey('b', 'a')).toBe(suggestionPairKey('a', 'b'));
  });
});
