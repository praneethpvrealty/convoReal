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
// ============================================================

const CONTACT_FILTER_LIMIT = 100;

interface InquiryRow {
  contact_id: string;
  property: { listing_type: string | null } | null;
}

/**
 * Hydrate `inquired_listing_types` on contacts in place of a column.
 *
 * One query for the whole batch: the callers are per-property fan-outs
 * that would otherwise hit the table once per lead. Best-effort — a
 * failure leaves the field undefined, which matches exactly the
 * behaviour before enquiry history was consulted at all.
 */
export async function attachInquiredListingTypes<T extends Contact>(
  db: SupabaseClient,
  accountId: string,
  contacts: T[]
): Promise<T[]> {
  if (contacts.length === 0) return contacts;

  // A contact-id filter travels in the URL, so it is only worth applying
  // for the narrow calls (one contact, one share dialog). A whole-account
  // fan-out reads the account's rows instead and indexes them in memory.
  let query = db
    .from('contact_property_inquiries')
    .select('contact_id, property:properties(listing_type)')
    .eq('account_id', accountId);
  if (contacts.length <= CONTACT_FILTER_LIMIT) {
    query = query.in(
      'contact_id',
      contacts.map((c) => c.id)
    );
  }

  const { data, error } = await query;
  if (error) {
    console.error('[inquired-intent] lookup failed:', error.message);
    return contacts;
  }

  const byContact = new Map<string, Set<string>>();
  for (const row of (data ?? []) as unknown as InquiryRow[]) {
    const property = Array.isArray(row.property)
      ? row.property[0]
      : row.property;
    const listingType = property?.listing_type;
    if (!listingType) continue;
    const held = byContact.get(row.contact_id);
    if (held) held.add(listingType);
    else byContact.set(row.contact_id, new Set([listingType]));
  }

  return contacts.map((contact) => {
    const types = byContact.get(contact.id);
    return types ? { ...contact, inquired_listing_types: [...types] } : contact;
  });
}
