// ============================================================
// Portal Inventory Sync — shared types between the harvest
// payload (Chrome extension), the parser, the matcher and the
// /api/portal-import routes.
// ============================================================

import type { PortalKey } from '@/lib/portals/post-kit';

/** One listing card as scraped off the agent's own portal
 *  dashboard. The extension keeps this deliberately dumb: raw
 *  card text plus whatever structure was trivially extractable
 *  (URL, id). All real parsing happens server-side so selector
 *  churn on the portals never strands data. */
export interface HarvestedListing {
  /** Portal's own listing id — from the detail URL or card meta.
   *  The extension falls back to a stable hash of the card text
   *  when no id is discoverable. */
  listingId: string;
  listingUrl?: string;
  rawText: string;
  /** Optional key/value pairs the scraper could label reliably. */
  fields?: Record<string, string>;
}

export interface HarvestedAccountStats {
  remainingListings?: number;
  remainingRefreshes?: number;
  planName?: string;
  planExpiresOn?: string;
}

export interface HarvestPayload {
  portal: PortalKey;
  harvestedAt: number;
  pageUrl?: string;
  listings: HarvestedListing[];
  accountStats?: HarvestedAccountStats;
}

export type ParsedPortalStatus = 'active' | 'expired' | 'under_review' | 'inactive';

/** Server-side parse of one HarvestedListing. */
export interface ParsedListing {
  portal: PortalKey;
  portalListingId: string;
  listingUrl: string | null;
  rawText: string;
  title: string;
  propertyType: string | null;
  listingFor: 'Sale' | 'Rent';
  price: number | null;
  bedrooms: number | null;
  areaSqft: number | null;
  locality: string | null;
  city: string | null;
  postedOn: string | null;
  expiresOn: string | null;
  portalStatus: ParsedPortalStatus;
  views: number | null;
  responses: number | null;
}

export type MatchBucket = 'linked' | 'auto_matched' | 'review' | 'new';

export interface MatchCandidate {
  propertyId: string;
  score: number;
  reasons: string[];
}

export interface MatchResult {
  bucket: MatchBucket;
  /** Set for 'linked' and 'auto_matched'. */
  propertyId: string | null;
  confidence: number;
  reasons: string[];
  /** Top alternatives surfaced in the review UI. */
  candidates: MatchCandidate[];
  /** Items across portals that describe the same physical property
   *  share a group key so committing them creates ONE property. */
  batchGroup: string | null;
}
