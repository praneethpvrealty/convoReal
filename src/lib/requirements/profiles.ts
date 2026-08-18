import type { Contact, ContactRequirementProfile } from '@/types';
import type { ExtractedPreferences } from '@/lib/ai/preference-extraction';

function areaLabel(sqft: number | null): string | null {
  if (!sqft || sqft <= 0) return null;
  const acres = sqft / 43_560;
  if (acres >= 0.5) {
    const rounded = Math.round(acres * 10) / 10;
    return `${rounded} acre${rounded === 1 ? '' : 's'}`;
  }
  return `${Math.round(sqft).toLocaleString('en-IN')} sq.ft.`;
}

export function requirementProfileTitle(
  preferences: ExtractedPreferences
): string {
  const location =
    preferences.areas[0] || preferences.projects[0] || 'Any area';
  const propertyType =
    preferences.property_types[0] ||
    preferences.property_categories[0] ||
    'Property';
  const min = areaLabel(preferences.land_area_min_sqft);
  const max = areaLabel(preferences.land_area_max_sqft);
  const size = min && max && min !== max ? `${min}–${max}` : min || max;
  return [location, size, propertyType].filter(Boolean).join(' · ');
}

export function createRequirementProfile(args: {
  id: string;
  rawText: string;
  source: ContactRequirementProfile['source'];
  preferences: ExtractedPreferences;
  now?: Date;
}): ContactRequirementProfile {
  const timestamp = (args.now || new Date()).toISOString();
  return {
    id: args.id,
    title: requirementProfileTitle(args.preferences),
    raw_text: args.rawText.trim(),
    source: args.source,
    active: true,
    property_types: args.preferences.property_types,
    property_categories: args.preferences.property_categories,
    bhk_min: args.preferences.bhk_min,
    bhk_max: args.preferences.bhk_max,
    budget_min: args.preferences.budget_min,
    budget_max: args.preferences.budget_max,
    land_area_min_sqft: args.preferences.land_area_min_sqft,
    land_area_max_sqft: args.preferences.land_area_max_sqft,
    areas: args.preferences.areas,
    excluded_areas: args.preferences.excluded_areas,
    projects: args.preferences.projects,
    min_roi: args.preferences.min_roi,
    listing_types: args.preferences.listing_types,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

export function hasStructuredRequirement(
  preferences: ExtractedPreferences
): boolean {
  return Boolean(
    preferences.property_types.length ||
    preferences.property_categories.length ||
    preferences.areas.length ||
    preferences.projects.length ||
    preferences.listing_types.length ||
    preferences.bhk_min ||
    preferences.bhk_max ||
    preferences.budget_min ||
    preferences.budget_max ||
    preferences.land_area_min_sqft ||
    preferences.land_area_max_sqft ||
    preferences.min_roi
  );
}

export function activeRequirementProfiles(
  contact: Contact
): ContactRequirementProfile[] {
  return (contact.requirement_profiles || []).filter(
    (profile) => profile?.active !== false && Boolean(profile?.raw_text?.trim())
  );
}

export function contactForRequirementProfile(
  contact: Contact,
  profile: ContactRequirementProfile
): Contact {
  return {
    ...contact,
    requirements: profile.raw_text,
    min_budget: undefined,
    max_budget: undefined,
    no_budget: false,
    min_roi: null,
    areas_of_interest: [],
    areas_of_interest_geo: [],
    projects_of_interest: [],
    property_interests: [],
    pref_property_types: profile.property_types,
    pref_property_categories: profile.property_categories,
    pref_bhk_min: profile.bhk_min,
    pref_bhk_max: profile.bhk_max,
    pref_budget_min: profile.budget_min,
    pref_budget_max: profile.budget_max,
    pref_land_area_min_sqft: profile.land_area_min_sqft,
    pref_land_area_max_sqft: profile.land_area_max_sqft,
    pref_areas: profile.areas,
    pref_excluded_areas: profile.excluded_areas,
    pref_projects: profile.projects,
    pref_min_roi: profile.min_roi,
    pref_listing_types: profile.listing_types,
    pref_extracted_at: profile.updated_at,
    contact_notes: [],
    requirement_profiles: [],
  };
}
