import { describe, expect, it } from 'vitest';

import type { JourneyItemSource } from '@/types';
import { JOURNEY_ITEM_SOURCE_LABELS, capturedItemTitle } from './captured';

const SOURCES: JourneyItemSource[] = [
  'manual',
  'whatsapp_share',
  'chat_import',
  'inquiry_import',
];

describe('captured tray', () => {
  it('[JRN-005] labels every way an item can be captured', () => {
    expect(Object.keys(JOURNEY_ITEM_SOURCE_LABELS).sort()).toEqual(
      [...SOURCES].sort()
    );
    for (const source of SOURCES) {
      expect(JOURNEY_ITEM_SOURCE_LABELS[source].trim()).not.toBe('');
    }
  });

  it('[JRN-005] titles a captured item by the other side of the pair', () => {
    const contact = { name: 'KP Anand', phone: '+919994035636' };
    const property = { title: 'Residential Plot in Sector 6 HSR Layout' };
    const item = { contact, property } as Parameters<
      typeof capturedItemTitle
    >[0];
    expect(capturedItemTitle(item, 'buyer')).toBe(property.title);
    expect(capturedItemTitle(item, 'property')).toBe('KP Anand');
    expect(
      capturedItemTitle(
        { contact: { ...contact, name: '' }, property } as typeof item,
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
});
