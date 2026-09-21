import { describe, expect, it } from 'vitest';
import { placeLine } from './place-line';

describe('placeLine', () => {
  it('does not repeat a locality the address already names', () => {
    expect(
      placeLine('Kormangala East, Bengaluru', 'Kormangala East', 'Bengaluru')
    ).toBe('Kormangala East, Bengaluru');
  });

  it('keeps distinct parts in order and ignores case and blanks', () => {
    expect(placeLine('HSR Layout', null, 'bengaluru', 'Karnataka', '')).toBe(
      'HSR Layout, bengaluru, Karnataka'
    );
    expect(placeLine('Sarjapur', 'sarjapur', 'Bengaluru')).toBe(
      'Sarjapur, Bengaluru'
    );
  });

  it('returns an empty string when nothing is known', () => {
    expect(placeLine(undefined, null, '')).toBe('');
  });
});
