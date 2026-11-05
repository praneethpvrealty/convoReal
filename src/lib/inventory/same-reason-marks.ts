import type { SupabaseClient } from '@supabase/supabase-js';
import { attachInquiredListingTypes } from '@/lib/contacts/inquired-intent';
import {
  SAME_REASON_REASONS,
  bandReasonDirection,
  propertyTypeAnswerGroups,
  sharesAreaReason,
  sharesBandReason,
  sharesTypeAnswer,
  type MatchRejectReason,
} from '@/lib/match-feedback';
import {
  getMatchingContacts,
  listingAreaSqft,
  listingBudgetValue,
  statedAreaSignature,
  statedAreaSizeSignature,
  statedBhkSignature,
  statedBudgetSignature,
  statedTypeSignature,
  typeGroupCategories,
} from '@/lib/matching';
import type { Contact, Property } from '@/types';

// Only the columns src/lib/matching.ts reads, plus what a match row
// renders — the same shape the web inventory fetches for its per-card
// match counts.
export const MATCH_CONTACT_COLUMNS =
  'id, name, phone, classification, name_tag, requirements, requirement_profiles, requirement_active, ' +
  'min_budget, max_budget, no_budget, min_roi, property_interests, areas_of_interest, ' +
  'areas_of_interest_geo, projects_of_interest, strict_project_match, strict_area_match, ' +
  'pref_property_types, pref_property_categories, pref_bhk_min, pref_bhk_max, ' +
  'pref_budget_min, pref_budget_max, pref_budget_anchor, pref_land_area_min_sqft, pref_land_area_max_sqft, pref_areas, pref_excluded_areas, pref_projects, ' +
  'pref_min_roi, requires_tenanted, pref_requires_tenanted, pref_listing_types, pref_extracted_at, contact_notes(note_text)';

const MATCH_POOL = ['Buyer', 'Agent'];

/**
 * Who else on the listing the agent's reason holds for, as a test on a
 * matched contact, or null when the reason names nothing to compare.
 * Type reads the agent's answer; location, budget and size read what
 * the marked contact states, so a contact with no area, budget or size
 * on file gives no basis and hides no one else. Size reads the plot or
 * built-up area first, and the BHK when the area gives no direction.
 */
function sameReasonTest(
  reason: MatchRejectReason,
  property: Property,
  marked: Contact,
  optionIds: string[]
): ((sibling: Contact) => boolean) | null {
  if (reason === 'type') {
    const groups = propertyTypeAnswerGroups(optionIds);
    if (groups.length === 0) return null;
    const answer = { groups, categories: typeGroupCategories(groups) };
    return (sibling) => sharesTypeAnswer(statedTypeSignature(sibling), answer);
  }
  if (reason === 'location') {
    const areas = statedAreaSignature(marked);
    if (!areas) return null;
    return (sibling) => sharesAreaReason(statedAreaSignature(sibling), areas);
  }
  if (reason === 'budget') {
    const budget = statedBudgetSignature(marked);
    const value = listingBudgetValue(property);
    if (!bandReasonDirection(budget, value)) return null;
    return (sibling) =>
      sharesBandReason(statedBudgetSignature(sibling), budget, value);
  }
  if (reason === 'size') {
    const measures = [
      {
        read: statedAreaSizeSignature,
        value: listingAreaSqft(property),
      },
      {
        read: statedBhkSignature,
        value: property.bedrooms ? Number(property.bedrooms) : null,
      },
    ];
    for (const { read, value } of measures) {
      const band = read(marked);
      if (!bandReasonDirection(band, value)) continue;
      return (sibling) => sharesBandReason(read(sibling), band, value);
    }
    return null;
  }
  return null;
}

/**
 * After an agent rules a contact out for this listing on type, location,
 * budget or size, rules out the rest of its Matching Contacts the same
 * reason holds for: those who want only the type the agent named, who
 * name only areas the marked contact names, or whose budget or size
 * stops where theirs does on the side the listing misses. Every brief a contact is ranked
 * on counts, so one that wants something wider keeps them. Only the
 * marked contact's own list (Buyers or Agents) is touched, only contacts
 * who rank for the listing now, and never anyone with an answer on file
 * for it: the insert skips an existing row, so a buyer's own "yes" or
 * "no" and an earlier mark stay as they are. Each joins the hidden list
 * as an ordinary agent mark with the same reason, restorable one by one;
 * nothing on their contact record changes. Best-effort: a failure hides
 * no one else and returns 0.
 */
export async function hideSameReasonMatches(
  db: SupabaseClient,
  args: {
    accountId: string;
    userId: string;
    property: Property;
    contact: Contact;
    reason: MatchRejectReason;
    optionIds: string[];
  }
): Promise<number> {
  const { accountId, userId, property, contact, reason, optionIds } = args;
  if (!SAME_REASON_REASONS.includes(reason)) return 0;
  if (!contact.classification || !MATCH_POOL.includes(contact.classification))
    return 0;
  const shares = sameReasonTest(reason, property, contact, optionIds);
  if (!shares) return 0;

  try {
    const { data: pool, error: poolError } = await db
      .from('contacts')
      .select(MATCH_CONTACT_COLUMNS)
      .eq('account_id', accountId)
      .eq('classification', contact.classification)
      .neq('id', contact.id);
    if (poolError) throw poolError;

    const ranked = getMatchingContacts(
      property,
      await attachInquiredListingTypes(
        db,
        accountId,
        (pool ?? []) as unknown as Contact[]
      )
    );
    const siblingIds = [
      ...new Set(
        ranked
          .filter(({ contact: c }) => c.id !== contact.id && shares(c))
          .map(({ contact: c }) => c.id)
      ),
    ];
    if (siblingIds.length === 0) return 0;

    const { data: inserted, error } = await db
      .from('listing_feedback')
      .upsert(
        siblingIds.map((contactId) => ({
          account_id: accountId,
          contact_id: contactId,
          property_id: property.id,
          verdict: 'rejected',
          reason,
          channel: 'app',
          source: 'agent',
          created_by: userId,
        })),
        { onConflict: 'contact_id,property_id', ignoreDuplicates: true }
      )
      .select('id');
    if (error) throw error;
    return inserted?.length ?? 0;
  } catch (err) {
    console.error('[match-feedback] same-reason marks failed:', err);
    return 0;
  }
}
