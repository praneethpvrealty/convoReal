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
});
