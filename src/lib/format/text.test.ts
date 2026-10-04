import { describe, expect, it } from 'vitest';
import { getInitials, truncate } from './text';

describe('getInitials', () => {
  it('takes the first letter of the first two words', () => {
    expect(getInitials('Ravi Kumar')).toBe('RK');
    expect(getInitials('john ronald tolkien')).toBe('JR');
  });

  it('keeps a single word to one letter', () => {
    expect(getInitials('praneeth')).toBe('P');
  });

  it('falls back to a question mark when there is no name', () => {
    expect(getInitials(null)).toBe('?');
    expect(getInitials(undefined)).toBe('?');
    expect(getInitials('')).toBe('?');
  });

  it('skips the empty words that repeated spaces leave', () => {
    expect(getInitials('  Ravi   Kumar ')).toBe('RK');
  });

  it('returns nothing for a name of spaces only', () => {
    expect(getInitials('   ')).toBe('');
  });
});

describe('truncate', () => {
  it('returns text within the limit unchanged', () => {
    expect(truncate('Whitefield 3BHK', 15)).toBe('Whitefield 3BHK');
    expect(truncate('  spaced  ', 20)).toBe('  spaced  ');
  });

  it('counts the ellipsis toward the limit', () => {
    const out = truncate('Whitefield 3BHK villa', 10);
    expect(out).toBe('Whitefiel…');
    expect(out).toHaveLength(10);
  });
});
