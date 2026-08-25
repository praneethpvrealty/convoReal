import { describe, it, expect } from 'vitest';
import type { Property } from '@/types';
import { filterPropertiesBySearch } from './search-filter';

const property = (overrides: Partial<Property>): Property =>
  ({
    id: crypto.randomUUID(),
    title: 'Untitled',
    location: 'Bengaluru',
    type: 'Flat/ Apartment',
    price: 10000000,
    ...overrides,
  }) as Property;

describe('filterPropertiesBySearch', () => {
  it('returns everything for an empty query', () => {
    const list = [property({ title: 'A' }), property({ title: 'B' })];
    expect(filterPropertiesBySearch(list, '  ')).toHaveLength(2);
  });

  it('matches free text against title, locality and project', () => {
    const list = [
      property({ title: 'Villa in Whitefield' }),
      property({ title: 'Plot', sublocality: 'HSR Layout' }),
      property({ title: 'Flat', project: 'Prestige Lakeside' }),
    ];
    expect(filterPropertiesBySearch(list, 'hsr')).toHaveLength(1);
    expect(filterPropertiesBySearch(list, 'prestige')[0].title).toBe('Flat');
    expect(filterPropertiesBySearch(list, 'whitefield')[0].title).toBe(
      'Villa in Whitefield'
    );
  });

  it('applies a parsed price ceiling', () => {
    const list = [
      property({ title: 'Cheap', price: 5000000 }),
      property({ title: 'Costly', price: 90000000 }),
    ];
    expect(
      filterPropertiesBySearch(list, 'under 1 cr').map((p) => p.title)
    ).toEqual(['Cheap']);
  });

  it('keeps only rent-yielding listings when asked', () => {
    const list = [
      property({ title: 'Yielding', roi: 6 }),
      property({ title: 'Bare' }),
    ];
    expect(
      filterPropertiesBySearch(list, 'rent yielding').map((p) => p.title)
    ).toEqual(['Yielding']);
  });
});
