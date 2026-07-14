import { describe, it, expect } from 'vitest';
import { suggestNameTagSplit } from './name-tag-split';

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
