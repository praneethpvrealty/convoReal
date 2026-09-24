import { describe, expect, it } from 'vitest';

import type { ParsedPropertyDraft } from '@/lib/ai/gemini';
import { formatDraftPreviewMessage } from '@/lib/ai/intake-core';

import {
  applyEKhataToDraft,
  eKhataDraftValues,
  khataYearBuiltFor,
} from './e-khata-draft';
import { looksLikeEKhata, sanitiseEKhata } from './e-khata-fields';

const NOW = new Date('2026-09-24T00:00:00Z');

const khata = sanitiseEKhata(
  {
    epid: '7425317720',
    khata_form: 'A',
    corporation: 'Bangalore South City Corporation',
    ward: 'Koramangala',
    address: 'NO.436, 18TH MAIN ROAD, KORAMANGALA, BANGALORE, 560095',
    latitude: 77.6238418,
    longitude: 12.9408126,
    site_dimensions_ft: { east_west: 68, north_south: 50 },
    site_area_sqft: 3401,
    ownership_type: 'Site with Building',
    floors: [
      { area_sqft: 4119, year_built: 1983 },
      { area_sqft: 706, year_built: 1983 },
    ],
    owners: ['ANJALI KAPUR'],
  },
  NOW
);

function draft(
  overrides: Partial<ParsedPropertyDraft> = {}
): ParsedPropertyDraft {
  return {
    title: null,
    price: null,
    location: null,
    type: null,
    sublocality: null,
    city: null,
    state: null,
    bedrooms: null,
    bathrooms: null,
    area_sqft: null,
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
    images: [],
    owner_contact_name: null,
    owner_contact_phone: null,
    owner_contact_role: null,
    listing_type: 'Sale',
    rent_per_month: null,
    maintenance: null,
    advance: null,
    gst: null,
    ...overrides,
  };
}

describe('eKhataDraftValues', () => {
  it('[EKH-005] maps the e-Khata onto listing draft fields, pin included, owner left out', () => {
    const values = eKhataDraftValues(khata);
    expect(values).toMatchObject({
      title: 'Site with Building in Koramangala',
      location: 'NO.436, 18TH MAIN ROAD, KORAMANGALA, BANGALORE, 560095',
      city: 'Bengaluru',
      state: 'Karnataka',
      latitude: 12.9408126,
      longitude: 77.6238418,
      google_map_link: 'https://www.google.com/maps?q=12.9408126,77.6238418',
      land_area: 3401,
      land_area_unit: 'Sq.Ft.',
      dimensions: '68x50',
      area_sqft: 4825,
      khata_epid: '7425317720',
      khata_form: 'A',
      year_built: 1983,
    });
    expect(values).not.toHaveProperty('owner_contact_name');
  });
});

describe('applyEKhataToDraft', () => {
  it('[EKH-005] lets the e-Khata win over the generic read of the same file but keeps a title', () => {
    const merged = applyEKhataToDraft(
      draft({
        title: '4 floor building for sale',
        location: 'Koramangala',
        land_area: 3000,
      }),
      khata,
      'prefer_khata'
    );
    expect(merged.title).toBe('4 floor building for sale');
    expect(merged.location).toContain('18TH MAIN ROAD');
    expect(merged.land_area).toBe(3401);
    expect(merged.khata_epid).toBe('7425317720');
  });

  it('[EKH-005] only fills gaps in a draft already under way', () => {
    const merged = applyEKhataToDraft(
      draft({
        title: 'Corner house',
        price: 95000000,
        location: '6th Block, Koramangala',
        area_sqft: 5000,
        latitude: 12.94,
        longitude: 77.62,
        google_map_link: 'https://maps.app.goo.gl/x',
        documents: ['property-documents/a/e-khata.pdf'],
      }),
      khata,
      'fill_gaps'
    );
    expect(merged).toMatchObject({
      title: 'Corner house',
      price: 95000000,
      location: '6th Block, Koramangala',
      area_sqft: 5000,
      latitude: 12.94,
      longitude: 77.62,
      google_map_link: 'https://maps.app.goo.gl/x',
      land_area: 3401,
      dimensions: '68x50',
      khata_form: 'A',
      year_built: 1983,
      documents: ['property-documents/a/e-khata.pdf'],
    });
  });

  it('[EKH-005] drops an owner the generic read found on an e-Khata but keeps one given in a draft under way', () => {
    const owner = {
      owner_contact_name: 'ANJALI KAPUR',
      owner_contact_phone: '919800000000',
      owner_contact_role: 'Owner',
      owner_contact_name_tag: 'Koramangala owner',
    };
    const opened = applyEKhataToDraft(draft(owner), khata, 'prefer_khata');
    expect(opened).toMatchObject({
      owner_contact_name: null,
      owner_contact_phone: null,
      owner_contact_role: null,
      owner_contact_name_tag: null,
    });
    expect(applyEKhataToDraft(draft(owner), {}, 'prefer_khata')).toMatchObject({
      owner_contact_name: null,
      owner_contact_phone: null,
    });
    expect(applyEKhataToDraft(draft(owner), khata, 'fill_gaps')).toMatchObject(
      owner
    );
  });

  it('[EKH-005] leaves site fields off an apartment and built-up area off a plot', () => {
    const flat = applyEKhataToDraft(
      draft({ type: 'Flat/ Apartment' }),
      khata,
      'prefer_khata'
    );
    expect(flat.land_area).toBeNull();
    expect(flat.dimensions).toBeNull();
    expect(flat.area_sqft).toBe(4825);
    const plot = applyEKhataToDraft(
      draft({ type: 'Residential Land/ Plot' }),
      khata,
      'fill_gaps'
    );
    expect(plot.land_area).toBe(3401);
    expect(plot.area_sqft).toBeNull();
    expect(plot.year_built).toBeUndefined();
    expect(plot.khata_epid).toBe('7425317720');
  });

  it('[EKH-005] clears the generic read of the same e-Khata where it does not fit the type', () => {
    const flat = applyEKhataToDraft(
      draft({
        type: 'Flat/ Apartment',
        land_area: 3401,
        land_area_unit: 'Sq.Ft.',
        dimensions: '68x50',
      }),
      khata,
      'prefer_khata'
    );
    expect(flat).toMatchObject({
      land_area: null,
      land_area_unit: null,
      dimensions: null,
    });
    const plot = applyEKhataToDraft(
      draft({
        type: 'Residential Land/ Plot',
        area_sqft: 4825,
        year_built: 1983,
      }),
      khata,
      'prefer_khata'
    );
    expect(plot).toMatchObject({ area_sqft: null, year_built: null });
    const underWay = applyEKhataToDraft(
      draft({ type: 'Flat/ Apartment', land_area: 1200 }),
      khata,
      'fill_gaps'
    );
    expect(underWay.land_area).toBe(1200);
  });

  it('[EKH-005] keeps a construction year off a plot after a concurrent merge', () => {
    expect(khataYearBuiltFor('Residential Land/ Plot', 1983)).toBeNull();
    expect(khataYearBuiltFor('Villa', 1983)).toBe(1983);
    expect(khataYearBuiltFor(null, 1983)).toBe(1983);
    expect(khataYearBuiltFor('Villa', null)).toBeNull();
  });

  it('[EKH-005] shows the khata and construction year on the WhatsApp draft preview', () => {
    const preview = formatDraftPreviewMessage(
      '📝 Draft',
      applyEKhataToDraft(draft(), khata, 'prefer_khata'),
      'collecting',
      ['Price', 'Type']
    );
    expect(preview).toContain('*e-Khata:* Form-A · ePID 7425317720');
    expect(preview).toContain('*Year Built:* 1983');
    expect(preview).toContain('*Dimensions:* 68x50');
  });

  it('[EKH-005] recognises a forwarded e-Khata from its WhatsApp file name', () => {
    expect(looksLikeEKhata('E KHATHA - ANJALI KAPUR.pdf')).toBe(true);
    expect(looksLikeEKhata('Prestige brochure.pdf')).toBe(false);
  });
});
