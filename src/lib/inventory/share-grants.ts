// ============================================================
// Property share grants — pre-approved reveals attached to a single
// share link (migration 198).
//
// The location guard (src/lib/inventory/location-guard.ts) decides
// what an external viewer may see by default; a grant is the agent
// saying "this recipient may see more" at the moment of sharing,
// instead of waiting for a request to walk back to their own queue.
//
// A grant only ever WIDENS one link. It carries no property state, so
// revoking it — or letting it lapse — puts that link back on the
// masked default with nothing to undo on the listing.
//
// Private photos (migration 199) are not widened into the payload —
// they live in a bucket with no read policy. The token itself becomes
// the credential for a service-role proxy,
// /api/public/share-grant/[token]/image/[index], mirroring what an
// approved location request already does for /api/public/reveal.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long a grant may live, chosen per share. A closed set rather than
 * a free-form duration: it keeps the API validation trivial, and there
 * is no honest reason to mint a key that outlives a deal cycle. The
 * longest option is the ceiling — a grant that never expires would make
 * revocation the only bound, which is exactly the failure this feature
 * is meant to avoid.
 */
export const SHARE_GRANT_TTL_CHOICES = [
  { key: '24h', label: '24 hours', ms: DAY_MS },
  { key: '7d', label: '7 days', ms: 7 * DAY_MS },
  { key: '30d', label: '30 days', ms: 30 * DAY_MS },
] as const;

export type ShareGrantTtlKey = (typeof SHARE_GRANT_TTL_CHOICES)[number]['key'];

export const DEFAULT_SHARE_GRANT_TTL_KEY: ShareGrantTtlKey = '7d';

export const SHARE_GRANT_TTL_MS = 7 * DAY_MS;

/** Resolves a caller-supplied choice, falling back to the default for
 *  anything unrecognised — an unknown key must not mint a longer-lived
 *  key than the agent asked for. */
export function ttlMsForKey(key: string | null | undefined): number {
  const choice = SHARE_GRANT_TTL_CHOICES.find((c) => c.key === key);
  return choice ? choice.ms : SHARE_GRANT_TTL_MS;
}

export interface ShareGrant {
  id: string;
  account_id: string;
  property_id: string;
  contact_id: string | null;
  token: string;
  reveal_location: boolean;
  reveal_documents: boolean;
  reveal_private_images: boolean;
  reveal_listing: boolean;
  expires_at: string;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
}

/** What a resolved grant permits, reduced to the flags the property
 *  view cares about. */
export interface GrantedReveals {
  location: boolean;
  documents: boolean;
  privateImages: boolean;
  /** Opens a teaser-gated page (migration 254). Independent of
   *  `location`: unlocking the listing must not hand over an address
   *  the location guard is still holding back. */
  listing: boolean;
}

export function mintShareGrantToken(ttlMs: number = SHARE_GRANT_TTL_MS): {
  token: string;
  expiresAt: string;
} {
  const raw =
    crypto.randomUUID().replace(/-/g, '') +
    crypto.randomUUID().replace(/-/g, '');
  return {
    token: raw.substring(0, 48),
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  };
}

export function isGrantLive(
  grant: Pick<ShareGrant, 'expires_at' | 'revoked_at'>,
  now: Date = new Date()
): boolean {
  if (grant.revoked_at) return false;
  return new Date(grant.expires_at) > now;
}

export function grantedReveals(
  grant: ShareGrant | null,
  now: Date = new Date()
): GrantedReveals {
  if (!grant || !isGrantLive(grant, now)) {
    return {
      location: false,
      documents: false,
      privateImages: false,
      listing: false,
    };
  }
  return {
    location: grant.reveal_location,
    documents: grant.reveal_documents,
    privateImages: grant.reveal_private_images,
    listing: grant.reveal_listing,
  };
}

/**
 * Resolves a `?g=` token for a specific property. Returns null unless
 * the grant is live AND was minted for this exact property — a token
 * pasted onto a different listing's link reveals nothing.
 *
 * Service-role read (public surface), so the property/account scoping
 * here IS the security boundary — see AGENTS.md §2.5.
 */
export async function resolveShareGrant(
  admin: SupabaseClient,
  token: string,
  propertyId: string,
  accountId: string
): Promise<ShareGrant | null> {
  if (!token || token.length < 20) return null;

  const { data, error } = await admin
    .from('property_share_grants')
    .select('*')
    .eq('token', token)
    .maybeSingle();

  if (error || !data) return null;

  const grant = data as ShareGrant;
  if (grant.property_id !== propertyId) return null;
  if (grant.account_id !== accountId) return null;
  if (!isGrantLive(grant)) return null;

  return grant;
}

/** Fire-and-forget open counter. Never blocks the render. */
export async function trackGrantView(
  admin: SupabaseClient,
  grant: Pick<ShareGrant, 'id' | 'view_count'>
): Promise<void> {
  const { error } = await admin
    .from('property_share_grants')
    .update({
      view_count: (grant.view_count ?? 0) + 1,
      last_viewed_at: new Date().toISOString(),
    })
    .eq('id', grant.id);
  if (error) {
    console.error('[share-grants] View tracking failed:', error);
  }
}
