import { describe, expect, it } from 'vitest';

import {
  JOURNEY_ITEM_SOURCE_LABELS,
  capturedItemSubtitle,
  capturedItemTitle,
} from './journey-captured';

const contact = {
  id: 'c1',
  name: 'KP Anand',
  phone: '+919994035636',
  classification: 'Buyer',
} as NonNullable<Parameters<typeof capturedItemTitle>[0]['contact']>;
const property = {
  id: 'p1',
  title: 'Residential Plot in Sector 6 HSR Layout',
  property_code: 'PROP-1095',
  location: 'HSR Layout',
};

describe('captured tray', () => {
  it('[JRN-005] labels every way an item can be captured', () => {
    expect(Object.keys(JOURNEY_ITEM_SOURCE_LABELS).sort()).toEqual([
      'chat_import',
      'inquiry_import',
      'manual',
      'whatsapp_share',
    ]);
  });

  it('[JRN-005] titles a captured item by the other side of the pair', () => {
    expect(capturedItemTitle({ contact, property }, 'buyer')).toBe(
      property.title
    );
    expect(capturedItemTitle({ contact, property }, 'property')).toBe(
      'KP Anand'
    );
    expect(
      capturedItemTitle(
        { contact: { ...contact, name: '' }, property },
        'property'
      )
    ).toBe('+919994035636');
    expect(capturedItemTitle({ contact: null, property: null }, 'buyer')).toBe(
      'Unknown property'
    );
    expect(
      capturedItemTitle({ contact: null, property: null }, 'property')
    ).toBe('Unknown contact');
  });

  it('[JRN-005] describes the pair with code and location or phone and classification', () => {
    expect(capturedItemSubtitle({ contact, property }, 'buyer')).toBe(
      'PROP-1095 · HSR Layout'
    );
    expect(capturedItemSubtitle({ contact, property }, 'property')).toBe(
      '+919994035636 · Buyer'
    );
    expect(
      capturedItemSubtitle(
        {
          contact,
          property: { ...property, property_code: null, location: null },
        },
        'buyer'
      )
    ).toBe('');
  });
});
