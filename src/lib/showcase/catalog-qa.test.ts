import { describe, expect, it } from 'vitest';
import {
  answerFromCatalog,
  buildCatalogContext,
  type CatalogListing,
} from './catalog-qa';

const catalog: CatalogListing[] = [
  {
    title: 'Skyline Residences',
    type: 'Flat/Apartment',
    listing_type: 'Sale',
    price: 9_000_000,
    location: 'Bangalore',
    sublocality: 'Whitefield',
    bedrooms: 3,
    area_sqft: 1650,
  } as CatalogListing,
  {
    title: 'Palm Grove Villa',
    type: 'Villa',
    listing_type: 'Sale',
    price: 42_000_000,
    location: 'Bangalore',
    sublocality: 'Indiranagar',
    bedrooms: 4,
    roi: 6,
  } as CatalogListing,
  {
    title: 'Central Court',
    type: 'Flat/Apartment',
    listing_type: 'Rent',
    rent_per_month: 55_000,
    location: 'Bangalore',
    sublocality: 'Whitefield',
    bedrooms: 2,
  } as CatalogListing,
];

describe('answerFromCatalog', () => {
  it('counts what is live, split by sale and rent', () => {
    const { answer, intent } = answerFromCatalog(
      'how many properties do you have?',
      catalog
    );
    expect(intent).toBe('count');
    expect(answer).toContain('3 listings');
    expect(answer).toContain('2 for sale');
    expect(answer).toContain('1 for rent');
  });

  it('states the real price range', () => {
    const { answer } = answerFromCatalog('what is the price range?', catalog);
    expect(answer).toContain('₹90,00,000');
    expect(answer).toContain('₹4,20,00,000');
    expect(answer).toContain('₹55,000');
  });

  it('lists the areas actually stocked', () => {
    const { answer, intent } = answerFromCatalog(
      'which areas do you cover?',
      catalog
    );
    expect(intent).toBe('localities');
    expect(answer).toContain('Whitefield');
    expect(answer).toContain('Indiranagar');
  });

  it('lists the property types on offer', () => {
    const { answer } = answerFromCatalog(
      'what types of property do you have?',
      catalog
    );
    expect(answer).toContain('Flat/Apartment');
    expect(answer).toContain('Villa');
  });

  it('escalates judgement calls instead of answering them', () => {
    expect(
      answerFromCatalog('is the price negotiable?', catalog).answer
    ).toBeNull();
    expect(
      answerFromCatalog('can I get a home loan on these?', catalog).answer
    ).toBeNull();
    expect(
      answerFromCatalog('what is your brokerage?', catalog).answer
    ).toBeNull();
  });

  it('escalates anything it has no aggregate for', () => {
    expect(
      answerFromCatalog('which one has the best morning light?', catalog).answer
    ).toBeNull();
  });

  it('never answers from an empty catalog', () => {
    expect(
      answerFromCatalog('how many properties do you have?', []).answer
    ).toBeNull();
  });
});

describe('buildCatalogContext', () => {
  it('grounds the model in one line per listing', () => {
    const context = buildCatalogContext(catalog);
    expect(context.split('\n')).toHaveLength(3);
    expect(context).toContain('Skyline Residences');
    expect(context).toContain('₹55,000/month');
    expect(context).toContain('3 BHK');
  });

  it('caps the listing count so a big inventory cannot blow the prompt', () => {
    const big = Array.from({ length: 80 }, () => catalog[0]);
    expect(buildCatalogContext(big, 40).split('\n')).toHaveLength(40);
  });
});
