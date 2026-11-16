import { describe, expect, it } from 'vitest';

import {
  PROPERTY_EDIT_VERSION_FIELDS,
  PROPERTY_EDIT_VERSION_SELECT,
  propertyEditVersion,
} from './edit-version';

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  for (const field of PROPERTY_EDIT_VERSION_FIELDS) base[field] = null;
  return {
    ...base,
    title: 'Apartment building in HBR Layout',
    price: 110000000,
    status: 'Available',
    images: ['a.jpg', 'b.jpg'],
    features: ['BDA Allotted'],
    ...overrides,
  };
}

describe('propertyEditVersion', () => {
  it('[PRP-062] changes when a field an agent edits changes', () => {
    const opened = propertyEditVersion(row());
    expect(propertyEditVersion(row({ price: 105000000 }))).not.toBe(opened);
    expect(propertyEditVersion(row({ status: 'Sold' }))).not.toBe(opened);
    expect(propertyEditVersion(row({ images: ['b.jpg', 'a.jpg'] }))).not.toBe(
      opened
    );
  });

  it('[PRP-062] ignores what background work writes to the row', () => {
    const opened = propertyEditVersion(row());
    expect(
      propertyEditVersion(
        row({
          updated_at: '2026-11-16T10:00:00Z',
          meta_catalog_synced_at: '2026-11-16T10:00:01Z',
          video_status: 'ready',
          latitude: 13.03,
        })
      )
    ).toBe(opened);
  });

  it('[PRP-062] reads the same row the same way whatever its key order', () => {
    const a = row({ features: [{ name: 'Lift', floor: 2 }] });
    const b = row({ features: [{ floor: 2, name: 'Lift' }] });
    expect(propertyEditVersion(a)).toBe(propertyEditVersion(b));
  });

  it('[PRP-062] gives no version for a row that lacks a tracked field', () => {
    const partial = row();
    delete partial.sublocality;
    expect(propertyEditVersion(partial)).toBeNull();
    expect(propertyEditVersion(null)).toBeNull();
  });

  it('[PRP-062] selects exactly the fields it fingerprints', () => {
    expect(PROPERTY_EDIT_VERSION_SELECT.split(', ')).toEqual([
      ...PROPERTY_EDIT_VERSION_FIELDS,
    ]);
  });
});
