import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// The listings a contact enquired about.
//
// A match row says a contact fits this property and how well. What it
// could never say is whether the agent has spoken to them about
// anything before — a 79% match who enquired about two listings last
// week is a different call from a 79% match who has never asked about
// anything.
//
// The aggregation and the per-contact cap run in SQL (migration
// 20260821050000) so neither the payload nor the work grows with the
// tenant's enquiry history.
// ============================================================

export interface InquiredProperty {
  id: string;
  title: string | null;
  property_code: string | null;
  listing_type: string | null;
  inquiry_date: string | null;
  inquiry_source: string | null;
}

interface InquiryRow {
  contact_id: string;
  properties: InquiredProperty[] | null;
}

/**
 * The most recent enquiries per contact, newest first, keyed by contact
 * id. Best-effort: a failure yields an empty map, which renders exactly
 * as a contact with no enquiry history does.
 */
export async function fetchInquiredProperties(
  db: SupabaseClient,
  accountId: string,
  contactIds: string[],
  limit = 3
): Promise<Map<string, InquiredProperty[]>> {
  const byContact = new Map<string, InquiredProperty[]>();
  if (contactIds.length === 0) return byContact;

  const { data, error } = await db.rpc('contacts_inquired_properties', {
    p_account_id: accountId,
    p_contact_ids: contactIds,
    p_limit: limit,
  });
  if (error) {
    console.error('[inquired-properties] lookup failed:', error.message);
    return byContact;
  }

  for (const row of (data ?? []) as InquiryRow[]) {
    const properties = (row.properties ?? []).filter(Boolean);
    if (properties.length > 0) byContact.set(row.contact_id, properties);
  }
  return byContact;
}

/** Short label for one enquiry: the code when there is one, else the title. */
export function inquiredPropertyLabel(property: InquiredProperty): string {
  return property.property_code || property.title || 'Untitled listing';
}
