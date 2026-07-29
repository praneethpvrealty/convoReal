// ============================================================
// Buyer portal — the "matched to your brief" feed (server-only).
//
// Scoped exactly like every other /api/buyer read: through the
// caller's own buyer_contact_links. Two feeds, deliberately different
// in what they reveal:
//
//   curated   — published listings from the agencies that already hold
//               this buyer as a contact. Full detail, because the same
//               listings are on those agencies' public showcases.
//   deal_mode — cross-tenant owner listings the Deal Mode sweep
//               already matched to them, MASKED (locality and price
//               band only). The owning tenant never leaves the server.
//
// Preferences drive both, so editing the brief in the portal
// re-curates this feed on the next load.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact, Property } from '@/types';
import { storagePublicUrl } from '@/lib/storage/url';
import type { MaskedPropertySnapshot } from '@/lib/den/masking';
import { buyerAdmin, type BuyerContactLink, type BuyerContext } from './auth';
import {
  curateForBuyer,
  hasBuyerBrief,
  mergeCuratedFeeds,
  type CuratedMatch,
} from './matches-ranking';

/** Most recent listings scored per agency. A buyer's feed is a
 *  shortlist, not a catalog dump — the cap bounds the read on large
 *  inventories and is reported to the caller as `pool_capped`. */
const POOL_PER_ACCOUNT = 300;
const CURATED_LIMIT = 24;
const DEAL_MODE_LIMIT = 12;

/** Buyer-facing listing fields. An explicit list, not `*` — deal
 *  remarks, ownership status, documents and CRM internals must not
 *  ride along just because the row was selected. Mirrors the column
 *  discipline of /api/buyer/shortlist. */
const MATCH_PROPERTY_COLUMNS = [
  'id', 'account_id', 'title', 'type', 'listing_type', 'status',
  'price', 'rent_per_month', 'maintenance', 'location', 'sublocality',
  'city', 'state', 'project', 'bedrooms', 'bathrooms', 'area_sqft',
  'area_unit', 'land_area', 'land_area_unit', 'super_built_area',
  'facing_direction', 'features', 'nearby_highlights', 'rental_income',
  'roi', 'property_code', 'images', 'created_at',
].join(', ');

export interface BuyerMatchCard {
  score: number;
  reasons: string[];
  agency_name: string | null;
  /** Deep link into the agency's showcase, same shape as the shortlist. */
  showcase_path: string;
  property: Property;
}

export interface BuyerDealModeCard {
  /** match_events.id — the client's list key. */
  event_id: string;
  agency_name: string | null;
  score: number;
  chips: string[];
  created_at: string;
  listing: Omit<MaskedPropertySnapshot, 'owner_account_id' | 'property_id'>;
}

export interface BuyerMatchFeed {
  curated: BuyerMatchCard[];
  deal_mode: BuyerDealModeCard[];
  /** True when an agency's inventory exceeded the pool cap, so the feed
   *  saw only its most recent slice. */
  pool_capped: boolean;
  /** False when no linked contact carries a usable brief yet. */
  has_preferences: boolean;
}

async function loadLinkedContacts(
  db: SupabaseClient,
  links: BuyerContactLink[]
): Promise<Map<string, Contact>> {
  const byId = new Map<string, Contact>();
  if (links.length === 0) return byId;
  const { data, error } = await db
    .from('contacts')
    .select('*')
    .in(
      'id',
      links.map((l) => l.contactId)
    );
  if (error) {
    console.error('[buyer/matches] contacts query failed:', error.message);
    return byId;
  }
  for (const row of (data || []) as Contact[]) byId.set(row.id, row);
  return byId;
}

function showcasePath(property: Property, link: BuyerContactLink): string {
  const params = new URLSearchParams({
    property_id: property.property_code || property.id,
    ref: link.accountId,
  });
  params.set('v', link.contactId);
  return `/?${params.toString()}`;
}

async function curatedForLink(
  db: SupabaseClient,
  link: BuyerContactLink,
  contact: Contact
): Promise<{ matches: CuratedMatch[]; capped: boolean }> {
  const { data, error } = await db
    .from('properties')
    .select(MATCH_PROPERTY_COLUMNS)
    .eq('account_id', link.accountId)
    .eq('is_published', true)
    .eq('status', 'Available')
    .order('created_at', { ascending: false })
    .limit(POOL_PER_ACCOUNT);
  if (error) {
    console.error('[buyer/matches] property pool query failed:', error.message);
    return { matches: [], capped: false };
  }
  const pool = (data || []) as unknown as Property[];
  return {
    matches: curateForBuyer(pool, contact, { limit: CURATED_LIMIT }),
    capped: pool.length >= POOL_PER_ACCOUNT,
  };
}

async function dealModeForLink(
  db: SupabaseClient,
  link: BuyerContactLink
): Promise<BuyerDealModeCard[]> {
  const { data, error } = await db
    .from('match_events')
    .select('id, matches, subject_snapshot, created_at')
    .eq('account_id', link.accountId)
    .eq('source', 'deal_mode')
    .neq('status', 'dismissed')
    .contains('matches', [{ id: link.contactId }])
    .order('created_at', { ascending: false })
    .limit(DEAL_MODE_LIMIT);
  if (error) {
    console.error('[buyer/matches] match_events query failed:', error.message);
    return [];
  }

  const cards: BuyerDealModeCard[] = [];
  for (const row of data || []) {
    const snapshot = row.subject_snapshot as MaskedPropertySnapshot | null;
    if (!snapshot) continue;
    const target = (
      (row.matches || []) as Array<{ id: string; score?: number; chips?: string[] }>
    ).find((m) => m.id === link.contactId);
    cards.push({
      event_id: row.id as string,
      agency_name: link.agencyName,
      score: target?.score ?? 0,
      chips: target?.chips ?? [],
      created_at: row.created_at as string,
      // Rebuilt field by field, never spread: the masked snapshot also
      // carries the owning tenant and its property id so the agent-side
      // unlock route can find the listing, and neither may reach a
      // browser.
      listing: {
        type: snapshot.type,
        listing_type: snapshot.listing_type,
        locality: snapshot.locality,
        city: snapshot.city,
        price_band: snapshot.price_band,
        rent_band: snapshot.rent_band,
        bedrooms: snapshot.bedrooms,
        bathrooms: snapshot.bathrooms,
        area_sqft: snapshot.area_sqft,
        area_unit: snapshot.area_unit,
        deal_mode: snapshot.deal_mode,
      },
    });
  }
  return cards;
}

export async function getBuyerMatchFeed(ctx: BuyerContext): Promise<BuyerMatchFeed> {
  const empty: BuyerMatchFeed = {
    curated: [],
    deal_mode: [],
    pool_capped: false,
    has_preferences: false,
  };
  if (ctx.links.length === 0) return empty;

  const db = buyerAdmin();
  const contactsById = await loadLinkedContacts(db, ctx.links);
  const briefed = ctx.links
    .map((link) => ({ link, contact: contactsById.get(link.contactId) }))
    .filter((entry): entry is { link: BuyerContactLink; contact: Contact } =>
      Boolean(entry.contact && hasBuyerBrief(entry.contact))
    );

  const [curatedResults, dealModeResults] = await Promise.all([
    Promise.all(briefed.map(({ link, contact }) => curatedForLink(db, link, contact))),
    Promise.all(ctx.links.map((link) => dealModeForLink(db, link))),
  ]);

  const linkByAccount = new Map(ctx.links.map((l) => [l.accountId, l]));
  const curated = mergeCuratedFeeds(
    curatedResults.map((r) => r.matches),
    CURATED_LIMIT
  ).map((match) => {
    const link = linkByAccount.get(match.property.account_id) ?? ctx.links[0];
    return {
      score: match.score,
      reasons: match.reasons,
      agency_name: link.agencyName,
      showcase_path: showcasePath(match.property, link),
      property: {
        ...match.property,
        images: Array.isArray(match.property.images)
          ? match.property.images.map(storagePublicUrl)
          : match.property.images,
      },
    };
  });

  return {
    curated,
    deal_mode: dealModeResults
      .flat()
      .sort((a, b) => b.score - a.score || b.created_at.localeCompare(a.created_at))
      .slice(0, DEAL_MODE_LIMIT),
    pool_capped: curatedResults.some((r) => r.capped),
    has_preferences: briefed.length > 0,
  };
}
