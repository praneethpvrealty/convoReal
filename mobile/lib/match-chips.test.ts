import { describe, it, expect } from 'vitest';
import type { MatchDetails } from '@shared/lib/matching';
import { matchChips, scoreTone } from './match-chips';

function details(overrides: Partial<MatchDetails> = {}): MatchDetails {
  return {
    type: 'unknown',
    location: 'unknown',
    budget: 'unknown',
    bhk: 'unknown',
    roi: 'unknown',
    ...overrides,
  };
}

describe('matchChips', () => {
  it('labels a category-level type hit the way the web does', () => {
    const chips = matchChips(
      details({ type: 'partial', location: 'unknown', budget: 'match' })
    );
    expect(chips.map((c) => c.label)).toEqual([
      'Category match',
      'No location preference',
      'Budget fit',
    ]);
  });

  it('keeps type, location and budget in that order', () => {
    const chips = matchChips(
      details({ type: 'match', location: 'partial', budget: 'partial' })
    );
    expect(chips.map((c) => c.label)).toEqual([
      'Type match',
      'Same city',
      'Budget flexible',
    ]);
  });

  it('reports an unstated preference as its own muted chip', () => {
    const chips = matchChips(details());
    expect(chips.every((c) => c.tone === 'muted')).toBe(true);
    expect(chips).toHaveLength(3);
  });

  it('adds BHK and ROI chips only when they carry a verdict', () => {
    expect(
      matchChips(details({ bhk: 'match', roi: 'match' })).map((c) => c.label)
    ).toContain('BHK fit');
    expect(
      matchChips(details({ bhk: 'mismatch' })).map((c) => c.label)
    ).toContain('BHK differs');
    expect(
      matchChips(details({ roi: 'mismatch' })).map((c) => c.label)
    ).not.toContain('ROI met');
  });
});

describe('scoreTone', () => {
  it('splits at the web badge thresholds', () => {
    expect(scoreTone(70)).toBe('strong');
    expect(scoreTone(69)).toBe('fair');
    expect(scoreTone(30)).toBe('fair');
    expect(scoreTone(29)).toBe('weak');
  });
});
