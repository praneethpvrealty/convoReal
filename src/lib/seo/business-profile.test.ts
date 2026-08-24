import { describe, expect, it } from 'vitest';
import type { Property } from '@/types';
import { buildPublicBusinessProfile } from './business-profile';

describe('buildPublicBusinessProfile', () => {
  it('deduplicates public areas and reports the latest inventory update', () => {
    const properties = [
      {
        type: 'Commercial Building',
        sublocality: 'JP Nagar',
        city: 'Bengaluru',
        location: 'Confidential exact address',
        updated_at: '2026-08-12T00:00:00.000Z',
      },
      {
        type: 'commercial building',
        sublocality: 'jp nagar',
        city: 'Bengaluru',
        updated_at: '2026-08-18T00:00:00.000Z',
      },
    ] as Property[];

    const profile = buildPublicBusinessProfile('Aryavarta Realty', properties);

    expect(profile.areasServed).toEqual(['JP Nagar', 'Bengaluru']);
    expect(profile.propertyTypes).toEqual(['Commercial Building']);
    expect(profile.inventoryLastUpdated).toBe('2026-08-18T00:00:00.000Z');
    expect(profile.description).not.toContain('Confidential exact address');
  });

  it('cleans inventory-derived copy and treats Bangalore as Bengaluru', () => {
    const properties = [
      {
        type: 'Residential Land/ Plot',
        sublocality: 'JP Nagar',
        city: 'Bangalore',
      },
      {
        type: 'Residential Land / Plot',
        sublocality: 'HBR Layout',
        city: 'Bengaluru',
      },
    ] as Property[];

    const profile = buildPublicBusinessProfile(
      'Aryavarta Ventures',
      properties
    );

    expect(profile.areasServed).toEqual([
      'JP Nagar',
      'HBR Layout',
      'Bengaluru',
    ]);
    expect(profile.propertyTypes).toEqual(['Residential Land / Plot']);
    expect(profile.description).toBe(
      'Aryavarta Ventures helps buyers, sellers, investors, and property owners with Residential Land / Plot across JP Nagar, HBR Layout, and Bengaluru. Explore current listings or contact our team to discuss your property requirements.'
    );
  });

  it('uses settings-authored public profile copy and lists', () => {
    const profile = buildPublicBusinessProfile(
      'Aryavarta Ventures',
      [
        {
          type: 'Residential House',
          city: 'Bangalore',
        },
      ] as Property[],
      {
        description:
          'Independent real estate advisory for land and commercial transactions.',
        areasServed: ['Bengaluru', 'JP Nagar', 'bengaluru'],
        propertyTypes: ['Commercial Property', 'Land Aggregation'],
      }
    );

    expect(profile.description).toBe(
      'Independent real estate advisory for land and commercial transactions.'
    );
    expect(profile.areasServed).toEqual(['Bengaluru', 'JP Nagar']);
    expect(profile.propertyTypes).toEqual([
      'Commercial Property',
      'Land Aggregation',
    ]);
  });
});
