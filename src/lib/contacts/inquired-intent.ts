import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact } from '@/types';

// ============================================================
// Listing intent derived from enquiry history.
//
// Most leads never state "buying" or "renting" anywhere the matching
// engine can read: pref_listing_types is empty and the requirement text
// says nothing either way. What they did do is enquire about listings,
// and those listings each carry a listing_type. A lead who has only
// ever asked about properties for sale is shopping to buy, so a lease
// reaching them through Match Radar, a digest or a share is noise.
//
// This module answers that one question — which listing types has this
// contact actually enquired about — and hands the answer to
// src/lib/matching.ts on Contact.inquired_listing_types.
//
// The aggregation itself runs in SQL (migration 20260820152500) so neither the
// payload nor the work grows with the tenant's enquiry history.
// ============================================================

interface IntentRow {
  contact_id: string;
  listing_types: string[] | null;
}

/**
 * Hydrate `inquired_listing_types` on contacts in place of a column.
 *
 * One round trip for the whole batch: the callers are per-property
 * fan-outs that would otherwise hit the table once per lead. The
 * contact ids travel in the RPC body, so the batch size is not bounded
 * by URL length. Best-effort — a failure leaves the field undefined,
 * which matches exactly the behaviour before enquiry history was
 * consulted at all.
 */
export async function attachInquiredListingTypes<T extends Contact>(
  db: SupabaseClient,
  accountId: string,
  contacts: T[]
): Promise<T[]> {
  if (contacts.length === 0) return contacts;

  const { data, error } = await db.rpc('contacts_inquired_listing_types', {
    p_account_id: accountId,
    p_contact_ids: contacts.map((c) => c.id),
  });
  if (error) {
    console.error('[inquired-intent] lookup failed:', error.message);
    return contacts;
  }

  const byContact = new Map<string, string[]>();
  for (const row of (data ?? []) as IntentRow[]) {
    const types = (row.listing_types ?? []).filter(Boolean);
    if (types.length > 0) byContact.set(row.contact_id, types);
  }

  return contacts.map((contact) => {
    const types = byContact.get(contact.id);
    return types ? { ...contact, inquired_listing_types: types } : contact;
  });
}
