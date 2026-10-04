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
// This module answers that question — which listing types has this
// contact actually enquired about — and hands the answer to
// src/lib/matching.ts on Contact.inquired_listing_types. It also hands
// over the prices of those listings (Contact.inquired_prices): a portal
// lead's budget is seeded from the enquired listing's price, and the
// matcher reads that anchor as a ceiling rather than a stated budget.
//
// The aggregation itself runs in SQL (migration 20260820152500) so neither the
// payload nor the work grows with the tenant's enquiry history.
// ============================================================

interface IntentRow {
  contact_id: string;
  listing_types: string[] | null;
}

interface PriceRow {
  contact_id: string;
  prices: (number | string)[] | null;
}

/**
 * Hydrate `inquired_listing_types` and `inquired_prices` on contacts in
 * place of columns.
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

  const contactIds = contacts.map((c) => c.id);
  const [types, prices] = await Promise.all([
    db.rpc('contacts_inquired_listing_types', {
      p_account_id: accountId,
      p_contact_ids: contactIds,
    }),
    db.rpc('contacts_inquired_prices', {
      p_account_id: accountId,
      p_contact_ids: contactIds,
    }),
  ]);

  const byContact = new Map<string, string[]>();
  if (types.error) {
    console.error('[inquired-intent] lookup failed:', types.error.message);
  } else {
    for (const row of (types.data ?? []) as IntentRow[]) {
      const listingTypes = (row.listing_types ?? []).filter(Boolean);
      if (listingTypes.length > 0) byContact.set(row.contact_id, listingTypes);
    }
  }

  const pricesByContact = new Map<string, number[]>();
  if (prices.error) {
    console.error(
      '[inquired-intent] price lookup failed:',
      prices.error.message
    );
  } else {
    for (const row of (prices.data ?? []) as PriceRow[]) {
      if (!Array.isArray(row.prices)) continue;
      const values = row.prices
        .map(Number)
        .filter((price) => Number.isFinite(price) && price > 0);
      if (values.length > 0) pricesByContact.set(row.contact_id, values);
    }
  }

  return contacts.map((contact) => {
    const listingTypes = byContact.get(contact.id);
    const inquiredPrices = pricesByContact.get(contact.id);
    if (!listingTypes && !inquiredPrices) return contact;
    return {
      ...contact,
      ...(listingTypes ? { inquired_listing_types: listingTypes } : {}),
      ...(inquiredPrices ? { inquired_prices: inquiredPrices } : {}),
    };
  });
}
