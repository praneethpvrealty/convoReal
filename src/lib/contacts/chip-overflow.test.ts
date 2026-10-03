import { describe, expect, it } from 'vitest';
import { splitChips, TABLE_CHIP_CAP } from '@/lib/contacts/chip-overflow';

describe('splitChips [CTM-013]', () => {
  it('shows the first two and names the rest in the overflow title', () => {
    const split = splitChips([
      '2nd block banashankari 6th stage',
      'Banashankari 6th Stage 2nd Block',
      'Banashankari',
    ]);
    expect(TABLE_CHIP_CAP).toBe(2);
    expect(split.visible).toEqual([
      '2nd block banashankari 6th stage',
      'Banashankari 6th Stage 2nd Block',
    ]);
    expect(split.hidden).toEqual(['Banashankari']);
    expect(split.hiddenTitle).toBe('Banashankari');
  });

  it('has no overflow when everything fits', () => {
    const split = splitChips(['Jayanagar', 'JP Nagar']);
    expect(split.visible).toEqual(['Jayanagar', 'JP Nagar']);
    expect(split.hidden).toEqual([]);
    expect(split.hiddenTitle).toBeUndefined();
  });

  it('drops blanks and duplicates before counting', () => {
    const split = splitChips(['Koramangala', ' ', 'Koramangala', 'HSR Layout']);
    expect(split.visible).toEqual(['Koramangala', 'HSR Layout']);
    expect(split.hidden).toEqual([]);
  });

  it('honours a custom cap', () => {
    const split = splitChips(['a', 'b', 'c', 'd'], 3);
    expect(split.visible).toEqual(['a', 'b', 'c']);
    expect(split.hiddenTitle).toBe('d');
  });
});
