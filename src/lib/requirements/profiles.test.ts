import { describe, expect, it } from 'vitest';
import { EMPTY_PREFERENCES } from '@/lib/ai/preference-extraction';
import type { Contact } from '@/types';
import {
  contactForRequirementProfile,
  createRequirementProfile,
  hasStructuredRequirement,
  requirementProfileTitle,
  reviseRequirementProfile,
} from './profiles';

const dabaspetePreferences = {
  ...EMPTY_PREFERENCES,
  property_types: ['Industrial Land'],
  property_categories: ['industrial' as const],
  land_area_min_sqft: 2 * 43_560,
  land_area_max_sqft: 3 * 43_560,
  areas: ['Dabaspete', 'STRR'],
};

describe('requirement profiles', () => {
  it('creates a readable title from the extracted brief', () => {
    expect(requirementProfileTitle(dabaspetePreferences)).toBe(
      'Dabaspete · 2 acres–3 acres · Industrial Land'
    );
  });

  it('maps a profile into an isolated matching contact', () => {
    const contact = {
      id: 'sidharth',
      name: 'Sidharth',
      classification: 'Buyer',
      min_budget: 10_000_000,
      pref_areas: ['Akshayanagar'],
      pref_property_types: ['Commercial Land'],
    } as Contact;
    const profile = createRequirementProfile({
      id: 'dabaspete-brief',
      rawText: 'For Dabaspete, 2/3 acre, for cold storage/warehouse near STRR',
      source: 'personal_whatsapp',
      preferences: dabaspetePreferences,
      now: new Date('2026-08-18T00:00:00Z'),
    });

    const isolated = contactForRequirementProfile(contact, profile);

    expect(isolated.pref_areas).toEqual(['Dabaspete', 'STRR']);
    expect(isolated.pref_land_area_min_sqft).toBe(87_120);
    expect(isolated.min_budget).toBeUndefined();
    expect(isolated.requirement_profiles).toEqual([]);
  });

  it('rejects extraction output with no usable matching signal', () => {
    expect(hasStructuredRequirement(EMPTY_PREFERENCES)).toBe(false);
    expect(hasStructuredRequirement(dabaspetePreferences)).toBe(true);
  });

  it('revises a brief without changing its identity or active state', () => {
    const existing = createRequirementProfile({
      id: 'dabaspete-brief',
      rawText: '2 acres near Dabaspete',
      source: 'personal_whatsapp',
      preferences: dabaspetePreferences,
      now: new Date('2026-08-18T00:00:00Z'),
    });
    existing.active = false;

    const revised = reviseRequirementProfile({
      profile: existing,
      rawText: '3 acres near STRR for a warehouse',
      preferences: {
        ...dabaspetePreferences,
        areas: ['STRR'],
        land_area_min_sqft: 3 * 43_560,
        land_area_max_sqft: 3 * 43_560,
      },
      now: new Date('2026-08-19T00:00:00Z'),
    });

    expect(revised.id).toBe(existing.id);
    expect(revised.created_at).toBe(existing.created_at);
    expect(revised.active).toBe(false);
    expect(revised.updated_at).toBe('2026-08-19T00:00:00.000Z');
    expect(revised.areas).toEqual(['STRR']);
    expect(revised.land_area_min_sqft).toBe(130_680);
  });
});
