// Resolving the property a portal lead originally enquired about, from
// whatever identifier their CSV export carries.
//
// This is the fact that makes a re-engagement message specific rather
// than a form letter ("the 3 BHK at Prestige Lakeside you enquired
// about" beats "your earlier property enquiry"), so the resolver
// accepts every identifier a portal export realistically contains and
// says plainly which ones it could not place.
//
// Resolution is bulk, not per row: a 200-lead import must not issue 200
// lookups. Classification is pure so the priority order is testable.

import type { SupabaseClient } from '@supabase/supabase-js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROPERTY_CODE_RE = /^PROP-\d+$/i;

export type PropertyRefKind = 'id' | 'code' | 'opaque';

/**
 * What kind of identifier this is. 'opaque' covers both a portal
 * listing id and a property title — they are indistinguishable by
 * shape, so the resolver tries both rather than guessing.
 */
export function classifyPropertyRef(raw: string | null | undefined): {
  kind: PropertyRefKind;
  value: string;
} | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  if (UUID_RE.test(value)) return { kind: 'id', value };
  if (PROPERTY_CODE_RE.test(value))
    return { kind: 'code', value: value.toUpperCase() };
  return { kind: 'opaque', value };
}

/**
 * Map each raw reference to a property id in this account. Unresolved
 * references are simply absent from the map — the caller imports the
 * lead anyway and reports the count, because a lead without a property
 * link is still a lead worth having.
 *
 * Priority: explicit id, then property code, then portal listing id,
 * then exact title. Earlier kinds win because they are unambiguous;
 * a title match is the only fuzzy one and is deliberately exact
 * (case-insensitive) rather than partial, so "Villa" cannot silently
 * attach fifty leads to one listing.
 */
export async function resolvePropertyRefs(
  db: SupabaseClient,
  accountId: string,
  rawRefs: readonly string[]
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();

  const byKind = {
    id: new Set<string>(),
    code: new Set<string>(),
    opaque: new Set<string>(),
  };
  // Original spelling per normalized value, so callers can look up by
  // exactly the string their CSV row carried.
  const originals = new Map<string, string[]>();

  for (const raw of rawRefs) {
    const parsed = classifyPropertyRef(raw);
    if (!parsed) continue;
    byKind[parsed.kind].add(parsed.value);
    const list = originals.get(parsed.value) ?? [];
    list.push(raw.trim());
    originals.set(parsed.value, list);
  }

  const record = (matchValue: string, propertyId: string) => {
    for (const original of originals.get(matchValue) ?? []) {
      if (!resolved.has(original)) resolved.set(original, propertyId);
    }
    if (!resolved.has(matchValue)) resolved.set(matchValue, propertyId);
  };

  if (byKind.id.size > 0) {
    const { data } = await db
      .from('properties')
      .select('id')
      .eq('account_id', accountId)
      .in('id', [...byKind.id]);
    for (const row of data ?? []) record(row.id as string, row.id as string);
  }

  if (byKind.code.size > 0) {
    const { data } = await db
      .from('properties')
      .select('id, property_code')
      .eq('account_id', accountId)
      .in('property_code', [...byKind.code]);
    for (const row of data ?? []) {
      if (row.property_code)
        record((row.property_code as string).toUpperCase(), row.id as string);
    }
  }

  if (byKind.opaque.size > 0) {
    const opaque = [...byKind.opaque];

    const { data: portalRows } = await db
      .from('property_portal_listings')
      .select('property_id, portal_listing_id')
      .eq('account_id', accountId)
      .in('portal_listing_id', opaque);
    for (const row of portalRows ?? []) {
      if (row.portal_listing_id) {
        record(row.portal_listing_id as string, row.property_id as string);
      }
    }

    // Titles only for whatever the portal lookup did not place.
    const unplaced = opaque.filter((v) => !resolved.has(v));
    if (unplaced.length > 0) {
      const { data: titleRows } = await db
        .from('properties')
        .select('id, title')
        .eq('account_id', accountId)
        .in('title', unplaced);
      for (const row of titleRows ?? []) {
        if (row.title) record(row.title as string, row.id as string);
      }

      // `.in()` on title is case-sensitive in Postgres; retry what is
      // still missing case-insensitively, one bounded query per value.
      const stillMissing = unplaced.filter((v) => !resolved.has(v));
      for (const value of stillMissing.slice(0, 50)) {
        const { data: ilikeRows } = await db
          .from('properties')
          .select('id')
          .eq('account_id', accountId)
          .ilike('title', value)
          .limit(2);
        // Ambiguous titles are left unresolved rather than guessed.
        if (ilikeRows?.length === 1) record(value, ilikeRows[0].id as string);
      }
    }
  }

  return resolved;
}
