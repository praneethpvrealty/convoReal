import type {
  AudienceContact,
  AudienceListing,
} from '@shared/lib/inventory/listing-audience';

/**
 * The pure half of the listing-audience feature, kept apart from the
 * fetchers so it runs under the plain-Node test runner (mobile/AGENTS.md).
 *
 * Ported rather than imported: `@shared/` resolves types only, so a
 * runtime import of the web helper dies at Metro bundle time.
 */
export function audienceListingLabel(listing: AudienceListing): string {
  return listing.propertyCode || listing.title || 'Untitled listing';
}

/**
 * Narrow the picker to what an agent typed. An account with a hundred
 * engaged listings makes scrolling the wrong instrument — the listing
 * they mean is one they can already name, by title or by code.
 */
export function filterAudienceListings(
  listings: AudienceListing[],
  query: string
): AudienceListing[] {
  const q = query.trim().toLowerCase();
  if (!q) return listings;
  return listings.filter((listing) =>
    [listing.title, listing.propertyCode].some((value) =>
      value?.toLowerCase().includes(q)
    )
  );
}

/**
 * Which audience members can actually be reached on WhatsApp.
 *
 * Historical listing audiences are intentionally independent of the
 * current property's ranked match list. A contact can disappear from that
 * list when the source listing/contact is archived or simply because they
 * are not a preference match for the new property; that must not erase the
 * fact that they engaged with the source listing. `fetchListingAudience`
 * overlays those historical contacts into the current match query so the
 * existing selection/share UI can still render and send them.
 */
export function reachableAudienceIds(
  audience: AudienceContact[],
  loaded: { id: string; phone?: string | null }[]
): { ids: string[]; unreachable: number } {
  const byId = new Map(loaded.map((c) => [c.id, c]));
  const ids: string[] = [];
  for (const member of audience) {
    const known = byId.get(member.contactId);
    if (!(member.phone || known?.phone)) continue;
    ids.push(member.contactId);
  }
  return { ids, unreachable: audience.length - ids.length };
}
