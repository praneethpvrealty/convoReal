import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  buildPreferenceSourceText,
  extractContactPreferences,
  preferenceSourceHash,
  EMPTY_PREFERENCES,
} from '@/lib/ai/preference-extraction';

// POST /api/contacts/extract-preferences
// Body: { contactIds: string[] }
//
// Runs Gemini preference extraction over the given contacts'
// requirements + notes text and persists the result into the
// contacts.pref_* columns. Contacts whose source text is unchanged
// (pref_source_hash match) are skipped, so calling this repeatedly
// is cheap — the share dialog fires it for whatever contacts it is
// about to match.
//
// Requires agent+ role. Contacts are scoped to the caller's account
// via the RLS-scoped client.

const MAX_CONTACTS_PER_REQUEST = 25;
const CONCURRENCY = 3;

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');
    const body = (await request.json()) as { contactIds?: string[] };

    const contactIds = Array.isArray(body.contactIds)
      ? body.contactIds.filter((id) => typeof id === 'string').slice(0, MAX_CONTACTS_PER_REQUEST)
      : [];

    if (contactIds.length === 0) {
      return NextResponse.json({ error: 'contactIds is required' }, { status: 400 });
    }

    const { data: contacts, error } = await ctx.supabase
      .from('contacts')
      .select('id, requirements, pref_source_hash, contact_notes (note_text)')
      .eq('account_id', ctx.accountId)
      .in('id', contactIds);

    if (error) throw error;

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    const queue = [...(contacts || [])];

    async function worker() {
      while (queue.length > 0) {
        const contact = queue.shift();
        if (!contact) break;

        const sourceText = buildPreferenceSourceText(contact.requirements, contact.contact_notes);
        const hash = preferenceSourceHash(sourceText);
        if (hash === contact.pref_source_hash) {
          skipped++;
          continue;
        }

        try {
          const prefs = sourceText ? await extractContactPreferences(sourceText) : EMPTY_PREFERENCES;
          const { error: updateErr } = await ctx.supabase
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
              pref_min_roi: prefs.min_roi,
              pref_listing_types: prefs.listing_types,
              pref_source_hash: hash,
              pref_extracted_at: new Date().toISOString(),
            })
            .eq('id', contact.id)
            .eq('account_id', ctx.accountId);

          if (updateErr) throw updateErr;
          updated++;

          // Match Radar: this contact's stated preferences just changed —
          // surface matching inventory (fire-and-forget; a radar failure
          // must never fail the extraction response).
          import('@/lib/radar/engine')
            .then(({ generateMatchEventForContact, radarAdminClient }) =>
              generateMatchEventForContact(radarAdminClient(), ctx.accountId, contact.id)
            )
            .catch((radarErr) => {
              console.error(`[extract-preferences] Radar error for ${contact.id}:`, radarErr);
            });
        } catch (err) {
          console.error(`[extract-preferences] Failed for contact ${contact.id}:`, err);
          failed++;
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    return NextResponse.json({ updated, skipped, failed });
  } catch (err) {
    console.error('[POST /api/contacts/extract-preferences] Unexpected error:', err);
    return toErrorResponse(err);
  }
}
