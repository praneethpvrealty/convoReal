import { describe, expect, it } from 'vitest';
import type { Property } from '@/types';
import { buildPublicBusinessProfile } from './business-profile';
import { jsonLdScript, propertyJsonLd, realEstateAgentJsonLd } from './jsonld';

const property = {
  id: 'property-1',
  title: 'Three bedroom apartment in JP Nagar',
  type: 'Apartment',
  listing_type: 'Sale',
  price: 14_200_000,
  area_sqft: 1800,
  bedrooms: 3,
  sublocality: 'JP Nagar',
  city: 'Bengaluru',
  state: 'Karnataka',
  status: 'Available',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-18T00:00:00.000Z',
} as Property;

describe('propertyJsonLd', () => {
  it('describes listing attributes on the property entity', () => {
    const result = propertyJsonLd(
      property,
      'https://example.com/property/jp-nagar-apartment',
      'https://example.com/property.jpg',
      'https://example.com#business'
    );

    expect(result).toMatchObject({
      '@type': 'RealEstateListing',
      dateModified: property.updated_at,
      inLanguage: 'en-IN',
      publisher: { '@id': 'https://example.com#business' },
      contentLocation: {
        '@type': 'Place',
        address: {
          '@type': 'PostalAddress',
          addressLocality: 'JP Nagar, Bengaluru',
          addressRegion: 'Karnataka',
          addressCountry: 'IN',
        },
      },
      mainEntity: {
        '@type': 'Product',
        '@id': 'https://example.com/property/jp-nagar-apartment#property',
        category: 'Apartment',
        additionalProperty: [
          {
            '@type': 'PropertyValue',
            name: 'Area',
            value: 1800,
            unitText: 'sq ft',
          },
          {
            '@type': 'PropertyValue',
            name: 'Bedrooms',
            value: 3,
          },
        ],
      },
      offers: {
        '@type': 'Offer',
        price: 14_200_000,
        priceCurrency: 'INR',
        itemOffered: {
          '@id': 'https://example.com/property/jp-nagar-apartment#property',
        },
        offeredBy: { '@id': 'https://example.com#business' },
      },
    });
    expect(result).not.toHaveProperty('address');
    expect(result).not.toHaveProperty('floorSize');
    expect(result).not.toHaveProperty('numberOfRooms');
  });

  it('escapes markup-breaking characters in JSON-LD scripts', () => {
    expect(jsonLdScript({ name: '</script><script>' })).not.toContain(
      '</script>'
    );
  });
});

describe('realEstateAgentJsonLd', () => {
  it('publishes the brokerage identity and inventory-derived expertise', () => {
    const profile = buildPublicBusinessProfile('Aryavarta Realty', [property]);

    expect(
      realEstateAgentJsonLd({
        name: 'Aryavarta Realty',
        url: 'https://aryavarta.example',
        telephone: '+91 98765 43210',
        profile,
      })
    ).toMatchObject({
      '@type': 'RealEstateAgent',
      '@id': 'https://aryavarta.example#business',
      name: 'Aryavarta Realty',
      telephone: '+91 98765 43210',
      areaServed: [
        { '@type': 'Place', name: 'JP Nagar' },
        { '@type': 'Place', name: 'Bengaluru' },
      ],
      knowsAbout: ['Apartment'],
    });
  });
});
