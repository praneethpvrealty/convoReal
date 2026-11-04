import type { SupabaseClient } from '@supabase/supabase-js';
import { attachInquiredListingTypes } from '@/lib/contacts/inquired-intent';
import {
  propertyTypeAnswerGroups,
  sharesTypeAnswer,
} from '@/lib/match-feedback';
import { getMatchingContacts, statedTypeGroups } from '@/lib/matching';
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
 * After an agent rules a contact out for wrong type and says what they
 * want, rules out the rest of the listing's Matching Contacts who want
 * only that too: the reason the agent gave holds for each of them.
 * Only the contact's own list (Buyers or Agents) is touched, only
 * contacts who rank for the listing now, and never anyone with an answer
 * on file for it — the insert skips an existing row, so a buyer's own
 * "yes" or "no" and an earlier mark stay as they are. Each joins the
 * hidden list as an ordinary agent mark, restorable one by one. Their
 * own type is left alone: it already says what the answer says.
 * Best-effort: a failure hides no one else and returns 0.
 */
export async function hideSameTypeMatches(
  db: SupabaseClient,
  args: {
    accountId: string;
    userId: string;
    property: Property;
    contact: Pick<Contact, 'id' | 'classification'>;
    optionIds: string[];
  }
): Promise<number> {
  const { accountId, userId, property, contact, optionIds } = args;
  const answerGroups = propertyTypeAnswerGroups(optionIds);
  if (answerGroups.length === 0) return 0;
  if (!contact.classification || !MATCH_POOL.includes(contact.classification))
    return 0;

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
          .filter(
            ({ contact: c }) =>
              c.id !== contact.id &&
              sharesTypeAnswer(statedTypeGroups(c), answerGroups)
          )
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
          reason: 'type',
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
    console.error('[match-feedback] same-type marks failed:', err);
    return 0;
  }
}
