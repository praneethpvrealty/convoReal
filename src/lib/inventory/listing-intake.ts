// ============================================================
// The public "List your property" page, as a link.
//
// `/list?ref=<account>` is the account's one self-serve intake surface:
// an owner or an agent pastes the details, attaches photos and a
// brochure, and confirms their number on WhatsApp. The submission lands
// in the same pending-review queue as a listing typed into the office
// number, parsed by the same AI (src/lib/showcase/listing-verification.ts).
//
// Every surface that hands this link out must build it the same way, or
// a brokerage with its own subdomain sends links that land on the bare
// marketing domain. `ref` is always carried: unlike the showcase, the
// page resolves the account from the query string, not the host.
//
// See docs/property-intake-consolidation.md for the other intake paths
// and why this is the one to point people at.
// ============================================================

import { showcaseOriginForHost } from '@/lib/share-message-builder';

/**
 * Takes the site URL rather than reading the environment so it stays
 * pure and works from a route handler or a client component alike.
 */
export function publicListingIntakeUrl(
  siteUrl: string,
  subdomain: string | null,
  accountId: string
): string {
  const site = new URL(siteUrl);
  const url = new URL(
    '/list',
    showcaseOriginForHost(site.host, site.protocol, subdomain)
  );
  url.searchParams.set('ref', accountId);
  return url.toString();
}
