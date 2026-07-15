// ============================================================
// Portal listing matcher — decides whether a harvested listing
// IS an existing CRM property. This is the anti-duplicate core
// of portal sync, applying the inventory matching hierarchy:
//
//   Type gate → Location → Budget. Budget alone is NEVER a match.
//
// Buckets:
//   linked       — portal listing id / URL already tied to a
//                  property in property_portal_listings (tier 0).
//   auto_matched — high-confidence unique match; sync updates the
//                  existing property's portal row, creates nothing.
//   review       — plausible match(es); the agent picks in the UI.
//   new          — no plausible match; importable only via the
//                  agent's explicit confirmation.
//
// Cross-portal dedup: the same physical property harvested from
// two portals gets one batch_group, so committing the batch
// creates a single CRM property with two portal links.
// ============================================================

import type { Property } from '@/types';
import { categoryForType } from '@/lib/inventory-summary-builder';
import type { MatchCandidate, MatchResult, ParsedListing } from './types';

export const AUTO_MATCH_THRESHOLD = 0.85;
export const REVIEW_THRESHOLD = 0.45;
/** Auto-match must also beat the runner-up by this margin —
 *  two near-identical inventory rows always go to review. */
export const AMBIGUITY_GAP = 0.12;

export interface ExistingPortalLink {
  property_id: string;
  portal: string;
  portal_listing_id: string | null;
  listing_url: string | null;
}

const STOP_TOKENS = new Set([
  'the', 'and', 'for', 'with', 'near', 'main', 'road', 'layout', 'nagar',
  'phase', 'stage', 'block', 'sector', 'extension', 'ext', 'cross',
]);

export function normalizeToken(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function locationTokens(...parts: Array<string | null | undefined>): Set<string> {
  const tokens = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    for (const raw of part.split(/[\s,/-]+/)) {
      const t = normalizeToken(raw);
      if (t.length >= 3 && !STOP_TOKENS.has(t)) tokens.add(t);
    }
  }
  return tokens;
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hits = 0;
  for (const t of a) if (b.has(t)) hits++;
  return hits / Math.min(a.size, b.size);
}

function propertyPrice(p: Property, listingFor: 'Sale' | 'Rent'): number | null {
  if (listingFor === 'Rent') return p.rent_per_month ?? null;
  return p.price > 0 ? p.price : null;
}

/** Symmetric relative difference, 0 = identical. */
function priceDelta(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(a, b);
}

function normalizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '') || null;
}

export interface ScoreBreakdown {
  score: number;
  reasons: string[];
  typeGatePassed: boolean;
  locationSignal: boolean;
}

export function scoreListingAgainstProperty(listing: ParsedListing, property: Property): ScoreBreakdown {
  const reasons: string[] = [];

  // ── Type gate ──
  const listingCategory = listing.propertyType ? categoryForType(listing.propertyType) : null;
  const propertyCategory = categoryForType(property.type);
  let typeGatePassed = true;
  let typeScore = 0;
  if (listingCategory && listingCategory !== 'Other' && propertyCategory !== 'Other') {
    if (listingCategory !== propertyCategory) {
      return { score: 0, reasons: [`category mismatch (${listingCategory} vs ${propertyCategory})`], typeGatePassed: false, locationSignal: false };
    }
    typeScore = listing.propertyType === property.type ? 0.25 : 0.15;
    reasons.push(listing.propertyType === property.type ? 'exact type match' : 'same category');
  } else {
    typeGatePassed = false;
    typeScore = 0.05;
  }

  const propListingFor =
    property.listing_type === 'Rent' || property.listing_type === 'Built to Suit' ? 'Rent' : 'Sale';
  if (listing.listingFor !== propListingFor) {
    return { score: 0, reasons: [`listing purpose mismatch (${listing.listingFor} vs ${propListingFor})`], typeGatePassed, locationSignal: false };
  }

  // ── Location ──
  const listingLoc = locationTokens(listing.locality, listing.city, listing.title);
  const propertyLoc = locationTokens(property.sublocality, property.location, property.city, property.locality_canonical, property.project);
  const locOverlap = tokenOverlap(locationTokens(listing.locality, listing.city), propertyLoc);
  const titleOverlap = tokenOverlap(listingLoc, propertyLoc);
  const locationSignal = locOverlap >= 0.5 || titleOverlap >= 0.5;
  let locationScore = 0;
  if (locOverlap >= 0.99) {
    locationScore = 0.35;
    reasons.push('locality match');
  } else if (locationSignal) {
    locationScore = 0.25;
    reasons.push('locality overlap');
  }

  // ── Budget ──
  let priceScore = 0;
  const propPrice = propertyPrice(property, listing.listingFor);
  if (listing.price && propPrice) {
    const delta = priceDelta(listing.price, propPrice);
    if (delta <= 0.02) {
      priceScore = 0.25;
      reasons.push('price match');
    } else if (delta <= 0.1) {
      priceScore = 0.18;
      reasons.push('price within 10%');
    } else if (delta > 0.35) {
      priceScore = -0.2;
      reasons.push('price far apart');
    }
  }

  // ── Corroborators ──
  let detailScore = 0;
  if (listing.bedrooms && property.bedrooms) {
    if (listing.bedrooms === property.bedrooms) {
      detailScore += 0.12;
      reasons.push(`${listing.bedrooms} BHK match`);
    } else {
      detailScore -= 0.25;
      reasons.push('BHK mismatch');
    }
  }
  const propArea = property.area_sqft || null;
  if (listing.areaSqft && propArea) {
    const delta = priceDelta(listing.areaSqft, propArea);
    if (delta <= 0.05) {
      detailScore += 0.1;
      reasons.push('area match');
    } else if (delta > 0.4) {
      detailScore -= 0.15;
    }
  }
  const titleSim = tokenOverlap(locationTokens(listing.title), locationTokens(property.title));
  if (titleSim >= 0.6) {
    detailScore += 0.1;
    reasons.push('title similarity');
  }

  // Budget-only never matches: without a location signal the score
  // is capped below the review threshold unless type is exact too.
  let score = typeScore + locationScore + priceScore + detailScore;
  if (!locationSignal) {
    score = Math.min(score, REVIEW_THRESHOLD - 0.01);
  }
  if (!typeGatePassed) {
    score = Math.min(score, AUTO_MATCH_THRESHOLD - 0.01);
  }

  return { score: Math.max(0, Math.min(1, score)), reasons, typeGatePassed, locationSignal };
}

export function matchListing(
  listing: ParsedListing,
  properties: Property[],
  existingLinks: ExistingPortalLink[]
): MatchResult {
  // Tier 0 — portal identity already linked to a property.
  const byId = existingLinks.find(
    (l) => l.portal === listing.portal && l.portal_listing_id && l.portal_listing_id === listing.portalListingId
  );
  const listingUrlNorm = normalizeUrl(listing.listingUrl);
  const byUrl = listingUrlNorm
    ? existingLinks.find((l) => normalizeUrl(l.listing_url) === listingUrlNorm)
    : undefined;
  const identity = byId || byUrl;
  if (identity) {
    return {
      bucket: 'linked',
      propertyId: identity.property_id,
      confidence: 1,
      reasons: [byId ? 'portal listing id already linked' : 'listing URL already linked'],
      candidates: [],
      batchGroup: null,
    };
  }

  const scored: MatchCandidate[] = properties
    .map((p) => {
      const s = scoreListingAgainstProperty(listing, p);
      return { propertyId: p.id, score: s.score, reasons: s.reasons };
    })
    .filter((c) => c.score >= REVIEW_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (scored.length === 0) {
    return { bucket: 'new', propertyId: null, confidence: 0, reasons: ['no plausible match in inventory'], candidates: [], batchGroup: null };
  }

  const [best, second] = scored;
  const unambiguous = !second || best.score - second.score >= AMBIGUITY_GAP;
  if (best.score >= AUTO_MATCH_THRESHOLD && unambiguous) {
    return { bucket: 'auto_matched', propertyId: best.propertyId, confidence: best.score, reasons: best.reasons, candidates: scored, batchGroup: null };
  }
  return { bucket: 'review', propertyId: null, confidence: best.score, reasons: best.reasons, candidates: scored, batchGroup: null };
}

/** Groups listings that describe the same physical property —
 *  duplicates within one portal batch or across portals. Commit
 *  creates one property per group and links every member to it. */
export function groupCrossPortalDuplicates(
  listings: Array<{ key: string; parsed: ParsedListing }>
): Map<string, string> {
  const groups = new Map<string, string>();
  const assigned: Array<{ key: string; parsed: ParsedListing; group: string }> = [];

  for (const item of listings) {
    let group: string | null = null;
    for (const prev of assigned) {
      if (sameListing(item.parsed, prev.parsed)) {
        group = prev.group;
        break;
      }
    }
    if (!group) group = `grp:${item.parsed.portal}:${item.parsed.portalListingId}`;
    groups.set(item.key, group);
    assigned.push({ ...item, group });
  }
  return groups;
}

function sameListing(a: ParsedListing, b: ParsedListing): boolean {
  if (a.portal === b.portal && a.portalListingId === b.portalListingId) return true;
  if (a.listingFor !== b.listingFor) return false;

  const catA = a.propertyType ? categoryForType(a.propertyType) : null;
  const catB = b.propertyType ? categoryForType(b.propertyType) : null;
  if (catA && catB && catA !== catB) return false;
  if (a.bedrooms && b.bedrooms && a.bedrooms !== b.bedrooms) return false;

  const locOverlap = tokenOverlap(
    locationTokens(a.locality, a.city),
    locationTokens(b.locality, b.city)
  );
  if (locOverlap < 0.5) return false;

  if (a.price && b.price) return priceDelta(a.price, b.price) <= 0.05;
  // Without prices on both sides, require near-identical titles too.
  return tokenOverlap(locationTokens(a.title), locationTokens(b.title)) >= 0.7;
}
