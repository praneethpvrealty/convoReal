import { describe, expect, it } from 'vitest';
import {
  splitChips,
  splitTagChips,
  TABLE_CHIP_CAP,
} from '@/lib/contacts/chip-overflow';

describe('splitChips [CTM-014]', () => {
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

describe('splitTagChips [CTM-014]', () => {
  it("keeps one chip per tag name, with the first tag's colour, before capping", () => {
    const split = splitTagChips([
      { id: 't1', name: 'Budget 5-10Cr', color: '#f43f5e' },
      { id: 't2', name: 'budget 5-10cr', color: '#000000' },
      { id: 't3', name: ' ', color: '#ffffff' },
      { id: 't4', name: 'Commercial', color: '#10b981' },
      { id: 't5', name: '99acres Lead', color: '#0ea5e9' },
    ]);
    expect(split.visible.map((t) => [t.id, t.name, t.color])).toEqual([
      ['t1', 'Budget 5-10Cr', '#f43f5e'],
      ['t4', 'Commercial', '#10b981'],
    ]);
    expect(split.hidden.map((t) => t.id)).toEqual(['t5']);
    expect(split.hiddenTitle).toBe('99acres Lead');
  });
});
