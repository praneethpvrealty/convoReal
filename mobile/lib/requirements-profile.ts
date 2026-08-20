import type { Contact, ContactRequirementProfile } from '@shared/types';

/**
 * The requirement a contact is actively asking about — ported.
 *
 * `@shared/` is a TYPES-ONLY alias in this app: TypeScript resolves it
 * through tsconfig `paths`, but Metro has no matching resolver, so a
 * runtime import of a web `src/` value type-checks and then fails at
 * bundle time with "Unable to resolve module". That is exactly how the
 * OTA build broke — three screens imported `resolveRequirementSource`
 * across the boundary and nothing caught it until `expo export` ran on
 * `main`.
 *
 * So the function is ported rather than aliased, which is the rule the
 * rest of this directory already follows. It is pure and reads only
 * shared types, so the two copies cannot disagree about behaviour
 * without the shared type changing under both.
 *
 * Mirrors src/lib/requirements/profiles.ts — keep the two in step.
 */

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

/**
 * Pick the requirement source that best represents what this contact is
 * actively asking for: explicit primary requirement text first, then the
 * first active brief profile, then legacy columns.
 */
export function resolveRequirementSource(contact: Contact): Contact {
  if ((contact.requirements || '').trim()) return contact;

  const active = activeRequirementProfiles(contact)[0];
  if (!active) return contact;

  return contactForRequirementProfile(contact, active);
}
