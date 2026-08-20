/**
 * Turn what a contact told us into something the matcher can read.
 *
 * `contacts.requirements` is free text and matching does not read it —
 * `pref_*` is what getMatchingContacts, Match Radar and the buyer digest
 * actually consult. Anything that appends to `requirements` therefore has
 * to re-extract, or the contact stays invisible: a lead who typed
 * "Budget 35 to 45, advance 200000" and a list of localities had all of
 * it stored and none of it matchable.
 *
 * Best-effort by design. This runs off the back of an inbound message,
 * so a Gemini hiccup or a credit shortfall must leave the message
 * handled and the requirement text intact rather than failing the turn.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildPreferenceSourceText,
  extractContactPreferences,
  preferenceSourceHash,
} from '@/lib/ai/preference-extraction';
import { burnCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';

export interface PreferenceSyncResult {
  status: 'updated' | 'unchanged' | 'nothing-to-extract' | 'failed';
}

/**
 * Re-extracts a contact's preferences from their requirements + notes and
 * writes the pref_* columns. Skips the AI call when the source text has
 * not changed since the last extraction.
 */
export async function syncContactPreferences(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<PreferenceSyncResult> {
  try {
    const { data: contact } = await db
      .from('contacts')
      .select(
        'id, requirements, pref_source_hash, pref_listing_types, contact_notes (note_text)',
      )
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!contact) return { status: 'failed' };

    const sourceText = buildPreferenceSourceText(
      contact.requirements as string | null,
      contact.contact_notes as { note_text: string }[] | null,
    );
    if (!sourceText.trim()) return { status: 'nothing-to-extract' };

    const hash = preferenceSourceHash(sourceText);
    if (hash === contact.pref_source_hash) return { status: 'unchanged' };

    try {
      await burnCredits(accountId, 'contact_parse', AI_FEATURE_COSTS.contact_parse, {
        hardBlock: false,
      });
    } catch (err) {
      console.error('[preference-sync] credit burn failed (non-fatal):', err);
    }

    const prefs = await extractContactPreferences(sourceText);
    const { error } = await db
      .from('contacts')
      .update({
        pref_property_types: prefs.property_types,
        pref_property_categories: prefs.property_categories,
        pref_bhk_min: prefs.bhk_min,
        pref_bhk_max: prefs.bhk_max,
        pref_budget_min: prefs.budget_min,
        pref_budget_max: prefs.budget_max,
        pref_areas: prefs.areas,
        pref_excluded_areas: prefs.excluded_areas,
        pref_projects: prefs.projects,
        pref_suggested_tags: prefs.suggested_tags,
        pref_min_roi: prefs.min_roi,
        // Buy-or-rent is answered deliberately — an agent picking it
        // on the contact form, or a lead tapping the ladder's list —
        // and extraction returns [] for a brief that simply does not
        // mention it. Writing that back would erase a stated intent
        // every time the lead sends another message.
        pref_listing_types:
          prefs.listing_types.length > 0
            ? prefs.listing_types
            : ((contact.pref_listing_types as string[] | null) ?? []),
        pref_source_hash: hash,
        pref_extracted_at: new Date().toISOString(),
      })
      .eq('id', contactId)
      .eq('account_id', accountId);
    if (error) throw error;

    return { status: 'updated' };
  } catch (err) {
    console.error('[preference-sync] failed:', err instanceof Error ? err.message : err);
    return { status: 'failed' };
  }
}
