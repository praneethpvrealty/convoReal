/**
 * The audience of a listing: the contacts who enquired about it or were
 * identified viewing it on the showcase.
 *
 * Preference matching answers who *fits* a property. This answers who
 * already showed interest in one — the list an agent reaches for when a
 * new listing lands and the people who chased a comparable one last
 * week should hear about it first. Both surfaces select the whole
 * audience in a single action, so the two questions stay one screen
 * apart instead of one hand-picked list apart.
 *
 * Aggregation lives in Postgres (migration 294); this module maps the
 * rows and decides which of them a WhatsApp send can actually reach.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface AudienceListing {
  propertyId: string;
  title: string | null;
  propertyCode: string | null;
  contactsCount: number;
  lastAt: string | null;
}

export interface AudienceContact {
  contactId: string;
  name: string | null;
  phone: string | null;
  classification: string | null;
  nameTag: string | null;
  enquired: boolean;
  viewed: boolean;
  viewsCount: number;
  lastAt: string | null;
}

interface ListingRow {
  property_id: string;
  title: string | null;
  property_code: string | null;
  contacts_count: number | string | null;
  last_at: string | null;
}

interface AudienceRow {
  contact_id: string;
  name: string | null;
  phone: string | null;
  classification: string | null;
  name_tag: string | null;
  enquired: boolean | null;
  viewed: boolean | null;
  views_count: number | string | null;
  last_at: string | null;
}

export function mapAudienceListings(rows: ListingRow[]): AudienceListing[] {
  return rows.map((r) => ({
    propertyId: r.property_id,
    title: r.title,
    propertyCode: r.property_code,
    contactsCount: Number(r.contacts_count ?? 0),
    lastAt: r.last_at,
  }));
}

export function mapAudienceContacts(rows: AudienceRow[]): AudienceContact[] {
  return rows.map((r) => ({
    contactId: r.contact_id,
    name: r.name,
    phone: r.phone,
    classification: r.classification,
    nameTag: r.name_tag,
    enquired: Boolean(r.enquired),
    viewed: Boolean(r.viewed),
    viewsCount: Number(r.views_count ?? 0),
    lastAt: r.last_at,
  }));
}

export function audienceListingLabel(listing: AudienceListing): string {
  return listing.propertyCode || listing.title || 'Untitled listing';
}

/** "Enquired · 3 views", "Viewed", "Enquired" — why this contact is here. */
export function audienceReasonLabel(contact: AudienceContact): string {
  const parts: string[] = [];
  if (contact.enquired) parts.push('Enquired');
  if (contact.viewed) {
    parts.push(
      contact.viewsCount > 1 ? `${contact.viewsCount} views` : 'Viewed'
    );
  }
  return parts.join(' · ');
}

/**
 * Which of an audience the current screen can actually select.
 *
 * Every route out of the share flows is a WhatsApp send, and both
 * surfaces select by id against a contact list they already hold. An
 * audience member missing from that list (archived, pending review) or
 * without a phone number cannot be selected, and saying how many were
 * dropped beats silently selecting fewer people than the count promised.
 */
export function reachableAudienceIds(
  audience: AudienceContact[],
  loaded: { id: string; phone?: string | null }[]
): { ids: string[]; unreachable: number } {
  const byId = new Map(loaded.map((c) => [c.id, c]));
  const ids: string[] = [];
  for (const member of audience) {
    const known = byId.get(member.contactId);
    if (!known) continue;
    if (!(known.phone || member.phone)) continue;
    ids.push(member.contactId);
  }
  return { ids, unreachable: audience.length - ids.length };
}

export async function fetchAudienceListings(
  db: SupabaseClient,
  accountId: string,
  limit = 25
): Promise<AudienceListing[]> {
  const { data, error } = await db.rpc('account_audience_listings', {
    p_account_id: accountId,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return mapAudienceListings((data ?? []) as ListingRow[]);
}

export async function fetchListingAudience(
  db: SupabaseClient,
  accountId: string,
  propertyId: string
): Promise<AudienceContact[]> {
  const { data, error } = await db.rpc('property_audience', {
    p_account_id: accountId,
    p_property_id: propertyId,
  });
  if (error) throw new Error(error.message);
  return mapAudienceContacts((data ?? []) as AudienceRow[]);
}
