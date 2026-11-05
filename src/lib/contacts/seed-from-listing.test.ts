import { describe, expect, it, vi } from 'vitest';
import type { Contact } from '@/types';
import {
  hasSavedRequirement,
  requirementSeedFromListing,
  seedRequirementFromListing,
} from './seed-from-listing';

/**
 * [CNV-013] The 5 November 2026 Surya City thread: a lead whose record
 * held no requirement tapped "Update my preferences" under a notice
 * naming a sold 3,933 sq.ft residential plot at ₹2.4 Cr, and was told
 * nothing fits, then asked what kind of property they wanted. The
 * listing the notice named is the requirement.
 */

const SURYA_CITY = {
  type: 'Residential Land/ Plot',
  listing_type: 'Sale',
  price: 24000000,
  land_area: 3933,
  land_area_unit: 'Sq.Ft.',
  location: 'Surya City Phase 3, Bangalore, Karnataka',
  sublocality: 'Surya City Phase 3',
};

const empty = (over: Partial<Contact> = {}): Contact =>
  ({
    id: 'c-appa',
    account_id: 'acc-1',
    name: 'Appa',
    pref_property_types: [],
    pref_areas: [],
    areas_of_interest: [],
    property_interests: [],
    pref_listing_types: [],
    ...over,
  }) as unknown as Contact;

describe('requirementSeedFromListing', () => {
  it('[CNV-013] reads type, intent, locality, price anchor and a size band off the listing', () => {
    const seed = requirementSeedFromListing(
      SURYA_CITY,
      new Date('2026-11-05T02:38:00Z')
    );
    expect(seed).toEqual({
      pref_property_types: ['Residential Land/ Plot'],
      pref_listing_types: ['Sale'],
      pref_areas: ['Surya City Phase 3'],
      pref_budget_max: 24000000,
      pref_budget_anchor: 24000000,
      pref_land_area_min_sqft: 2950,
      pref_land_area_max_sqft: 5900,
      pref_extracted_at: '2026-11-05T02:38:00.000Z',
    });
  });

  it('maps a type the buyer list knows onto its full type set and categories', () => {
    const seed = requirementSeedFromListing({
      ...SURYA_CITY,
      type: 'Villa',
    });
    expect(seed?.pref_property_types).toEqual(['Residential House', 'Villa']);
  });

  it('keeps an unknown type verbatim rather than dropping it', () => {
    const seed = requirementSeedFromListing({
      ...SURYA_CITY,
      type: 'Residential PG building',
    });
    expect(seed?.pref_property_types).toEqual(['Residential PG building']);
  });

  it('falls back to the first usable location segment when the listing has no sublocality', () => {
    const seed = requirementSeedFromListing({
      ...SURYA_CITY,
      sublocality: null,
      location: 'Bilekanahalli, Bangalore',
    });
    expect(seed?.pref_areas).toEqual(['Bilekanahalli']);
  });

  it('converts the size band into square feet whatever unit the listing used', () => {
    const seed = requirementSeedFromListing({
      ...SURYA_CITY,
      land_area: 1,
      land_area_unit: 'Acre',
    });
    expect(seed?.pref_land_area_min_sqft).toBe(32670);
    expect(seed?.pref_land_area_max_sqft).toBe(65340);
  });

  it('leaves out a price of zero and a JV listing type, and returns null for an empty listing', () => {
    const seed = requirementSeedFromListing({
      ...SURYA_CITY,
      price: 0,
      listing_type: 'JV/JD',
    });
    expect(seed?.pref_budget_anchor).toBeUndefined();
    expect(seed?.pref_listing_types).toBeUndefined();
    expect(
      requirementSeedFromListing({
        type: null,
        listing_type: null,
        price: null,
        land_area: null,
        land_area_unit: null,
        location: null,
        sublocality: null,
      })
    ).toBeNull();
  });
});

describe('hasSavedRequirement', () => {
  it('is false for an empty record and true for any stated piece', () => {
    expect(hasSavedRequirement(empty())).toBe(false);
    expect(hasSavedRequirement(empty({ pref_areas: ['HSR'] }))).toBe(true);
    expect(hasSavedRequirement(empty({ max_budget: 5000000 }))).toBe(true);
    expect(hasSavedRequirement(empty({ no_budget: true }))).toBe(true);
    expect(hasSavedRequirement(empty({ requirements: '2 BHK' }))).toBe(true);
    expect(hasSavedRequirement(empty({ property_interests: ['Villa'] }))).toBe(
      true
    );
  });

  it('counts a saved buy-or-rent intent, so a Sale listing never overwrites a stated rental search', () => {
    expect(hasSavedRequirement(empty({ pref_listing_types: ['Rent'] }))).toBe(
      true
    );
    expect(hasSavedRequirement(empty({ pref_bhk_min: 2 }))).toBe(true);
  });

  it('counts an active requirement profile, and ignores a retired or empty one', () => {
    const profile = {
      id: 'rp-1',
      raw_text: '2 BHK in HSR under 1.5 Cr',
      active: true,
    } as unknown as NonNullable<Contact['requirement_profiles']>[number];
    expect(
      hasSavedRequirement(empty({ requirement_profiles: [profile] }))
    ).toBe(true);
    expect(
      hasSavedRequirement(
        empty({ requirement_profiles: [{ ...profile, active: false }] })
      )
    ).toBe(false);
    expect(
      hasSavedRequirement(
        empty({ requirement_profiles: [{ ...profile, raw_text: '  ' }] })
      )
    ).toBe(false);
  });
});

describe('seedRequirementFromListing', () => {
  function fakeDb() {
    const update = vi.fn();
    const eq2 = vi.fn(async () => ({ error: null }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    update.mockReturnValue({ eq: eq1 });
    return {
      db: { from: vi.fn(() => ({ update })) } as never,
      update,
      eq1,
      eq2,
    };
  }

  it('[CNV-013] writes the seed onto an empty record, scoped to the account', async () => {
    const { db, update, eq1, eq2 } = fakeDb();
    const seed = await seedRequirementFromListing({
      db,
      accountId: 'acc-1',
      contact: empty(),
      property: SURYA_CITY,
    });
    expect(seed?.pref_areas).toEqual(['Surya City Phase 3']);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ pref_budget_anchor: 24000000 })
    );
    expect(eq1).toHaveBeenCalledWith('id', 'c-appa');
    expect(eq2).toHaveBeenCalledWith('account_id', 'acc-1');
  });

  it('never overwrites a record that already states a requirement', async () => {
    const { db, update } = fakeDb();
    const seed = await seedRequirementFromListing({
      db,
      accountId: 'acc-1',
      contact: empty({ pref_areas: ['Koramangala'] }),
      property: SURYA_CITY,
    });
    expect(seed).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it('reports nothing written when the update fails', async () => {
    const { db, eq2 } = fakeDb();
    eq2.mockResolvedValueOnce({ error: { message: 'down' } } as never);
    const seed = await seedRequirementFromListing({
      db,
      accountId: 'acc-1',
      contact: empty(),
      property: SURYA_CITY,
    });
    expect(seed).toBeNull();
  });
});
