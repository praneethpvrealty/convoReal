import { describe, expect, it } from 'vitest';

import { rankContactSearchResults } from './contact-search-rank';

const contacts = [
  { id: '1', name: 'Arun Kumar', name_tag: null, phone: '+9191663549494' },
  {
    id: '2',
    name: 'Prasanna Kumar Gejje',
    name_tag: null,
    phone: '+919620065050',
  },
  {
    id: '3',
    name: 'Prem Kumar',
    name_tag: 'HSR Property owner',
    phone: '+917909999936',
  },
  { id: '4', name: 'Raj Kumar', name_tag: null, phone: '+919019141987' },
  { id: '5', name: 'Supreeth Kumar', name_tag: null, phone: '+919900000005' },
  { id: '6', name: 'Kumar', name_tag: null, phone: '+919900277111' },
];

describe('rankContactSearchResults', () => {
  it('keeps an exact name first even when it arrives after the visible result limit', () => {
    expect(
      rankContactSearchResults(contacts, 'Kumar', 5).map(
        (contact) => contact.id
      )
    ).toEqual(['6', '1', '2', '3', '4']);
  });

  it('ranks name prefixes before word-prefix and contains matches', () => {
    expect(
      rankContactSearchResults(contacts, 'Prem').map((contact) => contact.id)[0]
    ).toBe('3');
  });

  it('deduplicates exact and broad query results', () => {
    expect(
      rankContactSearchResults([contacts[5], ...contacts], 'Kumar')
    ).toHaveLength(contacts.length);
  });
});
