import { describe, expect, it } from 'vitest';
import type { Contact } from '@/types';
import {
  activityPropertyHref,
  contactDetailsHref,
  visitorContactHref,
} from './visitor-link';

describe('[PLS-002] visitor contact link', () => {
  it('opens the identified visitor’s contact details', () => {
    expect(visitorContactHref({ contact: { id: 'c-42' } as Contact })).toBe(
      '/contacts?contactId=c-42'
    );
  });

  it('gives an anonymous guest no link', () => {
    expect(visitorContactHref({ contact: null })).toBeNull();
  });

  it('opens a forwarded-link sender capsule on their contact details', () => {
    expect(contactDetailsHref('c-7')).toBe('/contacts?contactId=c-7');
  });
});

describe('[PLS-011] activity property link', () => {
  const property = { id: 'p-1', title: 'Old House' };

  it('opens the property an activity row names', () => {
    for (const event_type of [
      'view_property',
      'gallery',
      'map_click',
      'shortlist',
      'whatsapp_click',
    ] as const) {
      expect(activityPropertyHref({ event_type, property })).toBe(
        '/inventory?propertyId=p-1'
      );
    }
  });

  it('gives catalog opens, searches and unknown properties no link', () => {
    expect(activityPropertyHref({ event_type: 'open', property })).toBeNull();
    expect(activityPropertyHref({ event_type: 'search', property })).toBeNull();
    expect(
      activityPropertyHref({ event_type: 'view_property', property: null })
    ).toBeNull();
  });
});
