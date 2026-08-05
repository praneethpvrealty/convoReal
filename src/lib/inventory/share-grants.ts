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
// Deliberately NOT covered: private_images. Those live in a non-public
// bucket and are served through the approved-request proxy
// (/api/public/reveal/[token]/image/[idx]); a share grant reveals the
// address, map pin and documents only.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export const SHARE_GRANT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ShareGrant {
  id: string;
  account_id: string;
  property_id: string;
  contact_id: string | null;
  token: string;
  reveal_location: boolean;
  reveal_documents: boolean;
  expires_at: string;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
}

/** What a resolved grant permits, reduced to the two flags the
 *  property view cares about. */
export interface GrantedReveals {
  location: boolean;
  documents: boolean;
}

export function mintShareGrantToken(): { token: string; expiresAt: string } {
  const raw =
    crypto.randomUUID().replace(/-/g, '') +
    crypto.randomUUID().replace(/-/g, '');
  return {
    token: raw.substring(0, 48),
    expiresAt: new Date(Date.now() + SHARE_GRANT_TTL_MS).toISOString(),
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
    return { location: false, documents: false };
  }
  return {
    location: grant.reveal_location,
    documents: grant.reveal_documents,
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
