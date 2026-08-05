import { describe, it, expect } from 'vitest';
import type { Property } from '@/types';
import {
  isGuardedType,
  effectiveLocationPrivacy,
  localityLabel,
  toPublicPropertyView,
  canViewExactLocation,
  maskPropertyForViewer,
  maskName,
  maskPhone,
  PUBLIC_PROPERTY_FIELDS,
} from './location-guard';

const guardedProperty = {
  id: 'p1',
  account_id: 'a1',
  user_id: 'u-lister',
  title: 'Independent House in HSR Layout',
  description: 'A lovely house',
  price: 25000000,
  location: '12/4, 5th Main, 2nd Cross, HSR Layout Sector 2',
  sublocality: 'HSR Layout',
  city: 'Bangalore',
  state: 'Karnataka',
  type: 'Residential House',
  status: 'Available',
  listing_type: 'Sale',
  bedrooms: 3,
  bathrooms: 3,
  is_published: true,
  features: ['Corner site'],
  images: ['property-images/a1/img-1.jpg'],
  private_images: ['property-images-private/a1/img-2.jpg'],
  google_map_link: 'https://maps.app.goo.gl/secret',
  latitude: 12.9121,
  longitude: 77.6446,
  locality_place_id: 'place-123',
  locality_canonical: 'HSR Layout, Bangalore',
  notes: 'Owner wants quick close',
  deal_remarks: 'Negotiable below ask',
  owner_contact_id: 'owner-1',
  sold_price: 24000000,
  documents: ['property-documents/a1/deed.pdf'],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as unknown as Property;

describe('isGuardedType', () => {
  it.each([
    'Residential House',
    'Villa',
    'Farm House',
    'House',
    'Residential Land/ Plot',
    'Commercial Land',
    'Industrial Land',
    'Agricultural Land',
  ])('guards %s', (type) => {
    expect(isGuardedType(type)).toBe(true);
  });

  it.each([
    'Flat/ Apartment',
    'Builder Floor Apartment',
    'Studio Apartment',
    'Penthouse',
    'Commercial Office Space',
    'Commercial Shop',
    'Warehouse/ Godown',
  ])('does not guard %s', (type) => {
    expect(isGuardedType(type)).toBe(false);
  });
});

describe('effectiveLocationPrivacy', () => {
  it('derives locality for guarded types when unset', () => {
    expect(effectiveLocationPrivacy({ type: 'Villa' })).toBe('locality');
    expect(
      effectiveLocationPrivacy({ type: 'Villa', location_privacy: null })
    ).toBe('locality');
  });

  it('derives exact for open types when unset', () => {
    expect(effectiveLocationPrivacy({ type: 'Flat/ Apartment' })).toBe('exact');
  });

  it('explicit override wins over the type default', () => {
    expect(
      effectiveLocationPrivacy({ type: 'Villa', location_privacy: 'exact' })
    ).toBe('exact');
    expect(
      effectiveLocationPrivacy({
        type: 'Flat/ Apartment',
        location_privacy: 'locality',
      })
    ).toBe('locality');
  });

  it('ignores invalid stored values', () => {
    expect(
      effectiveLocationPrivacy({ type: 'Villa', location_privacy: 'banana' })
    ).toBe('locality');
  });
});

describe('localityLabel', () => {
  it('joins sublocality and city', () => {
    expect(
      localityLabel({ sublocality: 'HSR Layout', city: 'Bangalore' })
    ).toBe('HSR Layout, Bangalore');
  });

  it('falls back through city, state, then a generic label', () => {
    expect(localityLabel({ city: 'Bangalore' })).toBe('Bangalore');
    expect(localityLabel({ state: 'Karnataka' })).toBe('Karnataka');
    expect(localityLabel({})).toBe('Location available on request');
  });
});

describe('toPublicPropertyView', () => {
  const SENSITIVE_KEYS = [
    'latitude',
    'longitude',
    'google_map_link',
    'owner_contact_id',
    'notes',
    'deal_remarks',
    'documents',
    'private_images',
    'sold_price',
    'floor_tenancies',
    'locality_place_id',
    'locality_canonical',
    'min_bid',
    'deal_mode',
    'source_property_id',
  ];

  it('never leaks sensitive fields for a guarded property, even with revealExact', () => {
    const view = toPublicPropertyView(guardedProperty, {
      revealExact: true,
    }) as unknown as Record<string, unknown>;
    for (const key of [
      'owner_contact_id',
      'notes',
      'deal_remarks',
      'documents',
      'private_images',
      'sold_price',
      'locality_place_id',
      'locality_canonical',
    ]) {
      expect(view[key], key).toBeUndefined();
    }
    expect(view.location).toBe('HSR Layout, Bangalore');
    expect(view.google_map_link).toBeNull();
    expect(view.latitude).toBeNull();
    expect(view.longitude).toBeNull();
    expect(view.location_guarded).toBe(true);
    expect(view.private_images_count).toBe(1);
  });

  it('hides exact fields in buyer mode even for un-guarded properties', () => {
    const open = { ...guardedProperty, type: 'Flat/ Apartment' } as Property;
    const view = toPublicPropertyView(open, {
      revealExact: false,
    }) as unknown as Record<string, unknown>;
    expect(view.location).toBe('HSR Layout, Bangalore');
    expect(view.google_map_link).toBeNull();
    expect(view.location_guarded).toBe(false);
  });

  it('reveals exact fields for un-guarded properties in reveal surfaces', () => {
    const open = { ...guardedProperty, type: 'Flat/ Apartment' } as Property;
    const view = toPublicPropertyView(open, {
      revealExact: true,
    }) as unknown as Record<string, unknown>;
    expect(view.location).toBe(guardedProperty.location);
    expect(view.google_map_link).toBe(guardedProperty.google_map_link);
    expect(view.latitude).toBe(guardedProperty.latitude);
  });

  it('keeps the public whitelist free of sensitive keys', () => {
    for (const key of SENSITIVE_KEYS) {
      expect(PUBLIC_PROPERTY_FIELDS).not.toContain(key);
    }
  });

  it('a location grant overrides the type guard', () => {
    const view = toPublicPropertyView(guardedProperty, {
      revealExact: false,
      granted: { location: true, documents: false },
    }) as unknown as Record<string, unknown>;
    expect(view.location).toBe(guardedProperty.location);
    expect(view.google_map_link).toBe(guardedProperty.google_map_link);
    expect(view.latitude).toBe(guardedProperty.latitude);
    expect(view.longitude).toBe(guardedProperty.longitude);
    expect(view.location_revealed).toBe(true);
    // Nothing left to mask, so the request prompt stands down.
    expect(view.location_guarded).toBe(false);
  });

  it('a location grant does not drag documents along with it', () => {
    const view = toPublicPropertyView(guardedProperty, {
      revealExact: false,
      granted: { location: true, documents: false },
    }) as unknown as Record<string, unknown>;
    expect(view.documents).toBeUndefined();
  });

  it('a documents grant attaches documents and nothing else', () => {
    const view = toPublicPropertyView(guardedProperty, {
      revealExact: false,
      granted: { location: false, documents: true },
    }) as unknown as Record<string, unknown>;
    expect(view.documents).toEqual(guardedProperty.documents);
    expect(view.location).toBe('HSR Layout, Bangalore');
    expect(view.google_map_link).toBeNull();
    expect(view.location_revealed).toBe(false);
    expect(view.location_guarded).toBe(true);
  });

  it('a grant never widens the private-image or owner fields', () => {
    const view = toPublicPropertyView(guardedProperty, {
      revealExact: true,
      granted: { location: true, documents: true },
    }) as unknown as Record<string, unknown>;
    for (const key of [
      'private_images',
      'owner_contact_id',
      'notes',
      'deal_remarks',
      'sold_price',
    ]) {
      expect(view[key], key).toBeUndefined();
    }
    expect(view.private_images_count).toBe(1);
  });

  it('an empty grant leaves the masked defaults in place', () => {
    const view = toPublicPropertyView(guardedProperty, {
      revealExact: false,
      granted: { location: false, documents: false },
    }) as unknown as Record<string, unknown>;
    expect(view.location).toBe('HSR Layout, Bangalore');
    expect(view.documents).toBeUndefined();
    expect(view.location_guarded).toBe(true);
  });
});

describe('canViewExactLocation', () => {
  const p = { type: 'Villa', user_id: 'u-lister' };

  it('anyone sees un-guarded properties', () => {
    expect(
      canViewExactLocation(
        { role: 'viewer', userId: 'u-x' },
        { type: 'Flat/ Apartment', user_id: 'u-lister' }
      )
    ).toBe(true);
  });

  it('admin and owner see through the guard', () => {
    expect(canViewExactLocation({ role: 'admin', userId: 'u-x' }, p)).toBe(
      true
    );
    expect(canViewExactLocation({ role: 'owner', userId: 'u-x' }, p)).toBe(
      true
    );
  });

  it('the listing agent sees their own property', () => {
    expect(canViewExactLocation({ role: 'agent', userId: 'u-lister' }, p)).toBe(
      true
    );
  });

  it('other agents, coordinators and viewers are blocked', () => {
    expect(canViewExactLocation({ role: 'agent', userId: 'u-other' }, p)).toBe(
      false
    );
    expect(
      canViewExactLocation({ role: 'coordinator', userId: 'u-other' }, p)
    ).toBe(false);
    expect(canViewExactLocation({ role: 'viewer', userId: null }, p)).toBe(
      false
    );
  });
});

describe('maskPropertyForViewer', () => {
  it('passes privileged viewers through untouched', () => {
    const out = maskPropertyForViewer(guardedProperty, {
      role: 'owner',
      userId: 'u-x',
    });
    expect(out).toBe(guardedProperty);
  });

  it('substitutes locality and strips coordinates for blocked viewers', () => {
    const out = maskPropertyForViewer(guardedProperty, {
      role: 'agent',
      userId: 'u-other',
    });
    expect(out.location).toBe('HSR Layout, Bangalore');
    expect(out.google_map_link).toBeNull();
    expect(out.latitude).toBeNull();
    expect(out.longitude).toBeNull();
    expect(out.locality_place_id).toBeNull();
    expect(out.private_images).toEqual([]);
    expect(out.private_images_count).toBe(1);
    expect(out.location_guarded).toBe(true);
  });
});

describe('maskName / maskPhone', () => {
  it('masks names to a recognisable stub', () => {
    expect(maskName('Rahul Sharma')).toBe('Ra••• Sh•••');
    expect(maskName('Jo')).toBe('J•');
    expect(maskName('')).toBe('Someone');
  });

  it('masks phones keeping first two and last three digits', () => {
    expect(maskPhone('+919876543210')).toBe('98•••••210');
    expect(maskPhone('9876543210')).toBe('98•••••210');
    expect(maskPhone('123')).toBe('••••');
  });
});
