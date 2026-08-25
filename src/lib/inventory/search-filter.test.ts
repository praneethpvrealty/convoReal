import { describe, it, expect } from 'vitest';
import type { Property } from '@/types';
import {
  filterPropertiesBySearch,
  selectPinnedProperties,
} from './search-filter';

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

describe('selectPinnedProperties', () => {
  it('returns the listings named by the link, in link order', () => {
    const a = property({ title: 'A', property_code: 'CR-1' });
    const b = property({ title: 'B', property_code: 'CR-2' });
    const list = [a, b];
    expect(
      selectPinnedProperties(list, ['cr-2', 'CR-1']).map((p) => p.title)
    ).toEqual(['B', 'A']);
  });

  it('drops keys that no longer resolve, and passes everything through for an empty link', () => {
    const a = property({ title: 'A', property_code: 'CR-1' });
    expect(selectPinnedProperties([a], ['CR-9'])).toEqual([]);
    expect(selectPinnedProperties([a], [])).toHaveLength(1);
  });
});
