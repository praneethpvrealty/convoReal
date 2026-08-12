import { describe, it, expect } from 'vitest';
import type { ParsedPropertyDraft } from '@/lib/ai/gemini';
import { extractMapLinkFromText } from '@/lib/maps/map-links';
import {
  applyPinToDraft,
  buildPinParkedMessage,
  type PendingMapPin,
} from '@/lib/maps/pending-pin';

const pin: PendingMapPin = {
  mapLink: 'https://maps.app.goo.gl/r6siNQSvLCjCvxJ57?g_st=aw',
  location: 'HSR Layout, Bengaluru',
  sublocality: 'HSR Layout',
  city: 'Bengaluru',
  state: 'Karnataka',
  latitude: 12.9121,
  longitude: 77.6446,
};

function draft(
  overrides: Partial<ParsedPropertyDraft> = {}
): ParsedPropertyDraft {
  return {
    title: 'Commercial Property in HSR Layout',
    price: 113400000,
    location: null,
    type: 'Commercial Land',
    sublocality: null,
    city: null,
    state: null,
    bedrooms: null,
    bathrooms: null,
    area_sqft: 2835,
    land_area: null,
    land_area_unit: null,
    description: null,
    features: null,
    nearby_highlights: null,
    dimensions: null,
    facing_direction: null,
    rental_income: null,
    roi: null,
    google_map_link: null,
    latitude: null,
    longitude: null,
    images: [],
    ...overrides,
  } as ParsedPropertyDraft;
}

describe('extractMapLinkFromText', () => {
  it('reads the short link an agent forwards on its own', () => {
    expect(
      extractMapLinkFromText(
        'https://maps.app.goo.gl/r6siNQSvLCjCvxJ57?g_st=aw'
      )
    ).toBe('https://maps.app.goo.gl/r6siNQSvLCjCvxJ57?g_st=aw');
  });

  it('reads a pin sitting inside a sentence, without trailing punctuation', () => {
    expect(
      extractMapLinkFromText(
        'Site is here https://www.google.com/maps/place/HSR+Layout/@12.91,77.64,15z.'
      )
    ).toBe('https://www.google.com/maps/place/HSR+Layout/@12.91,77.64,15z');
  });

  it('reads the canonical URL a WhatsApp location message becomes', () => {
    expect(
      extractMapLinkFromText(
        'Star Super Market - https://www.google.com/maps/search/?api=1&query=12.9121,77.6446'
      )
    ).toBe('https://www.google.com/maps/search/?api=1&query=12.9121,77.6446');
  });

  it('turns a bare coordinate pair into a pin', () => {
    expect(extractMapLinkFromText('12.9121,77.6446')).toBe(
      'https://www.google.com/maps/search/?api=1&query=12.9121,77.6446'
    );
  });

  it('finds no pin in ordinary text or an unrelated link', () => {
    expect(
      extractMapLinkFromText(
        'Sir good location sir service road next to Toshiba company'
      )
    ).toBeNull();
    expect(
      extractMapLinkFromText('https://www.99acres.com/some-listing')
    ).toBeNull();
    expect(extractMapLinkFromText('')).toBeNull();
    expect(extractMapLinkFromText(null)).toBeNull();
  });
});

describe('applyPinToDraft', () => {
  it('attaches the pin and its parts to a listing that named no location', () => {
    const merged = applyPinToDraft(draft(), pin);
    expect(merged.google_map_link).toBe(pin.mapLink);
    expect(merged.latitude).toBe(12.9121);
    expect(merged.longitude).toBe(77.6446);
    expect(merged.location).toBe('HSR Layout, Bengaluru');
    expect(merged.city).toBe('Bengaluru');
    expect(merged.geo_resolved_from).toBe(pin.mapLink);
  });

  it("keeps the lister's own address and only fills the gaps around it", () => {
    const merged = applyPinToDraft(
      draft({
        location: 'service road next to Toshiba company',
        city: 'Bangalore',
      }),
      pin
    );
    expect(merged.location).toBe('service road next to Toshiba company');
    expect(merged.city).toBe('Bangalore');
    expect(merged.sublocality).toBe('HSR Layout');
    expect(merged.latitude).toBe(12.9121);
  });

  it('leaves a listing that carried its own pin untouched', () => {
    const own = draft({
      google_map_link: 'https://maps.app.goo.gl/own',
      latitude: 13.1,
      longitude: 77.7,
    });
    expect(applyPinToDraft(own, pin)).toBe(own);
  });

  it('does not claim a geocode it never got', () => {
    const merged = applyPinToDraft(draft(), {
      ...pin,
      latitude: null,
      longitude: null,
      location: null,
    });
    expect(merged.google_map_link).toBe(pin.mapLink);
    expect(merged.geo_resolved_from).toBeUndefined();
  });
});

describe('buildPinParkedMessage', () => {
  it('names the place when the pin resolved', () => {
    const msg = buildPinParkedMessage(pin);
    expect(msg).toContain('Location pin saved');
    expect(msg).toContain('HSR Layout, Bengaluru');
    expect(msg).toContain('Send the property details next');
  });

  it('still asks for the details when the pin could not be named', () => {
    const msg = buildPinParkedMessage({ ...pin, location: null });
    expect(msg).toContain('Location pin saved');
    expect(msg).toContain('Send the property details next');
  });
});
