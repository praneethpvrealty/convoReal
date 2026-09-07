import { describe, expect, it } from 'vitest';

import {
  propertyAvailabilityWhatsAppUrl,
  propertyDetailPrimaryAction,
} from './property-detail-primary-action';

describe('propertyDetailPrimaryAction', () => {
  it('keeps the selected-contact share action visible instead of Open Maps', () => {
    expect(
      propertyDetailPrimaryAction({
        selectedCount: 31,
        ownerPhone: false,
        hasMapLocation: true,
      })
    ).toEqual({
      kind: 'share',
      label: 'Share with 31 contacts',
      icon: 'paper-plane',
    });
  });

  it('restores the normal property action when no contacts are selected', () => {
    expect(
      propertyDetailPrimaryAction({
        selectedCount: 0,
        ownerPhone: false,
        hasMapLocation: true,
      })
    ).toEqual({ kind: 'maps', label: 'Open Maps', icon: 'map-outline' });
  });

  it('offers an availability check when the owner or referring agent is reachable', () => {
    expect(
      propertyDetailPrimaryAction({
        selectedCount: 0,
        ownerPhone: true,
        hasMapLocation: true,
      })
    ).toEqual({
      kind: 'availability',
      label: 'Check availability',
      icon: 'logo-whatsapp',
    });
  });

  it('prefills an addressed availability message for WhatsApp', () => {
    const url = propertyAvailabilityWhatsAppUrl(
      '+91 98862 17718',
      {
        property_code: 'PROP-1068',
        title: 'Pre-leased commercial building',
      },
      'Deepak'
    );

    expect(url).toMatch(/^https:\/\/wa\.me\/919886217718\?text=/);
    expect(decodeURIComponent(url.split('?text=')[1])).toContain(
      'Hello Deepak,\n\nCould you please confirm whether *PROP-1068 — Pre-leased commercial building* is still available?'
    );
  });
});
