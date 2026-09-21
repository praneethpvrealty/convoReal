import { describe, it, expect } from 'vitest';
import { splitImportedName, suggestNameTagSplit } from './name-tag-split';

describe('suggestNameTagSplit', () => {
  it('splits a trailing lexicon qualifier', () => {
    expect(suggestNameTagSplit('Nataraj Bank DSA')).toEqual({
      name: 'Nataraj',
      nameTag: 'Bank DSA',
    });
  });

  it('splits at the first descriptor, keeping multi-word names intact', () => {
    expect(suggestNameTagSplit('Suresh Kumar Bank DSA')).toEqual({
      name: 'Suresh Kumar',
      nameTag: 'Bank DSA',
    });
  });

  it('splits on all-caps acronyms like HDFC', () => {
    expect(suggestNameTagSplit('Ramesh HDFC')).toEqual({
      name: 'Ramesh',
      nameTag: 'HDFC',
    });
  });

  it('splits on tokens containing digits', () => {
    expect(suggestNameTagSplit('Manju Plumber 2')).toEqual({
      name: 'Manju',
      nameTag: 'Plumber 2',
    });
    expect(suggestNameTagSplit('Ravi Site 2')).toEqual({
      name: 'Ravi',
      nameTag: 'Site 2',
    });
  });

  it('keeps a title-cased locality prefix with the internal tag', () => {
    expect(
      suggestNameTagSplit('Lokendranath Jp Nagar 100 Feet Road Owner')
    ).toEqual({
      name: 'Lokendranath',
      nameTag: 'Jp Nagar 100 Feet Road Owner',
    });
  });

  it('is case-insensitive on lexicon words', () => {
    expect(suggestNameTagSplit('Lakshmi tiles')).toEqual({
      name: 'Lakshmi',
      nameTag: 'tiles',
    });
  });

  it('leaves plain names alone', () => {
    expect(suggestNameTagSplit('Praneeth Kumar')).toBeNull();
    expect(suggestNameTagSplit('Akanksha')).toBeNull();
  });

  it('does not treat single-letter initials as acronyms', () => {
    expect(suggestNameTagSplit('Praneeth Kumar S')).toBeNull();
    expect(suggestNameTagSplit('R Nataraj')).toBeNull();
  });

  it('bails when the descriptor is the first token', () => {
    expect(suggestNameTagSplit('Bank Manager Ravi')).toBeNull();
    expect(suggestNameTagSplit('DSA Nataraj')).toBeNull();
  });

  it('handles empty and whitespace-only input', () => {
    expect(suggestNameTagSplit('')).toBeNull();
    expect(suggestNameTagSplit('   ')).toBeNull();
  });
});

describe('splitImportedName', () => {
  it('[CTM-005] fills first name, second name and name tag from one phonebook entry', () => {
    expect(
      splitImportedName('Dr Murali Makam Owner Hsr Has Building On 27th Main')
    ).toEqual({
      name: 'Dr Murali',
      secondName: 'Makam',
      nameTag: 'Owner Hsr Has Building On 27th Main',
    });
    expect(splitImportedName('Suresh Kumar Bank DSA')).toEqual({
      name: 'Suresh',
      secondName: 'Kumar',
      nameTag: 'Bank DSA',
    });
  });

  it('[CTM-005] keeps a title or leading initial with the first name', () => {
    expect(splitImportedName('Mr. Ramesh Gowda')).toEqual({
      name: 'Mr. Ramesh',
      secondName: 'Gowda',
      nameTag: null,
    });
    expect(splitImportedName('R Nataraj')).toEqual({
      name: 'R Nataraj',
      secondName: null,
      nameTag: null,
    });
    expect(splitImportedName('Dr')).toEqual({
      name: 'Dr',
      secondName: null,
      nameTag: null,
    });
  });

  it('[CTM-005] puts every token after the first name into the second name', () => {
    expect(splitImportedName('Praneeth Kumar S')).toEqual({
      name: 'Praneeth',
      secondName: 'Kumar S',
      nameTag: null,
    });
  });

  it('[CTM-005] leaves a single name alone', () => {
    expect(splitImportedName('Akanksha')).toEqual({
      name: 'Akanksha',
      secondName: null,
      nameTag: null,
    });
    expect(splitImportedName('  ')).toEqual({
      name: '',
      secondName: null,
      nameTag: null,
    });
  });
});
