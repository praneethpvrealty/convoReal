import { describe, expect, it } from 'vitest';
import type { Property } from '@/types';
import { buildPublicBusinessProfile } from './business-profile';
import {
  howToJsonLd,
  jsonLdScript,
  propertyJsonLd,
  realEstateAgentJsonLd,
  webApplicationJsonLd,
} from './jsonld';

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

describe('howToJsonLd', () => {
  it('[PUB-002] numbers every stage and states the total time in days', () => {
    const result = howToJsonLd({
      name: 'Khata transfer',
      description: 'After registration.',
      url: 'https://example.com/tools/property-process/khata-transfer',
      totalDays: 16,
      steps: [
        { name: 'Application', text: 'File it.' },
        { name: 'Verification', text: 'Inspector checks.' },
      ],
    });

    expect(result['@type']).toBe('HowTo');
    expect(result.totalTime).toBe('P16D');
    expect(result.step).toEqual([
      {
        '@type': 'HowToStep',
        position: 1,
        name: 'Application',
        text: 'File it.',
        url: 'https://example.com/tools/property-process/khata-transfer#step-1',
      },
      {
        '@type': 'HowToStep',
        position: 2,
        name: 'Verification',
        text: 'Inspector checks.',
        url: 'https://example.com/tools/property-process/khata-transfer#step-2',
      },
    ]);
    expect(
      howToJsonLd({
        name: 'x',
        description: 'y',
        url: 'https://example.com/x',
        totalDays: 0,
        steps: [],
      }).totalTime
    ).toBeUndefined();
  });
});

describe('webApplicationJsonLd', () => {
  it('[PUB-002] describes a free web tool served for one area', () => {
    const result = webApplicationJsonLd({
      name: 'Guidance value finder',
      description: 'Find it.',
      url: 'https://example.com/tools/guidance-value',
      publisherName: 'ConvoReal',
      areaServed: 'Karnataka, India',
    });
    expect(result['@type']).toBe('WebApplication');
    expect(result.isAccessibleForFree).toBe(true);
    expect(result.offers).toEqual({
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'INR',
    });
    expect(result.areaServed).toEqual({
      '@type': 'AdministrativeArea',
      name: 'Karnataka, India',
    });
    expect(result.publisher).toEqual({
      '@type': 'Organization',
      name: 'ConvoReal',
    });
  });
});
