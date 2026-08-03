import { describe, expect, it } from 'vitest';
import { consonantSkeleton, textContainsProject } from './project-match';

describe('consonantSkeleton', () => {
  it('drops vowels', () => {
    expect(consonantSkeleton('purva')).toBe('prv');
  });

  it('folds aspirated spellings onto the same spine', () => {
    expect(consonantSkeleton('sobha')).toBe(consonantSkeleton('shobha'));
  });

  it('keeps a leading h', () => {
    expect(consonantSkeleton('hebbal')).toBe('hbl');
  });
});

describe('textContainsProject', () => {
  it('matches the exact project name', () => {
    expect(textContainsProject('Purva Westend', 'Purva Westend')).toBe(true);
  });

  it('matches a builder shorthand against the registered name', () => {
    expect(textContainsProject('Puravankara Westend', 'Purva Westend')).toBe(true);
  });

  it('matches in the other direction too', () => {
    expect(textContainsProject('Purva Westend Phase 2', 'Puravankara Westend')).toBe(true);
  });

  it('matches across an aspirated spelling difference', () => {
    expect(textContainsProject('Shobha Dream Acres', 'Sobha Dream Acres')).toBe(true);
  });

  it('matches a project named inside a listing title', () => {
    expect(textContainsProject('2 BHK in Puravankara Westend, Kudlu', 'Purva Westend')).toBe(true);
  });

  it('does not match a different project by the same builder', () => {
    expect(textContainsProject('Purva Vantage', 'Purva Westend')).toBe(false);
  });

  it('does not match a different builder', () => {
    expect(textContainsProject('Prestige Westend', 'Purva Westend')).toBe(false);
  });

  it('does not match on a short shared opening', () => {
    expect(textContainsProject('Pearl Heights', 'Purva Heights')).toBe(false);
  });

  it('is false for empty input', () => {
    expect(textContainsProject('', 'Purva Westend')).toBe(false);
    expect(textContainsProject('Purva Westend', '')).toBe(false);
  });
});
