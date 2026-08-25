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
 * Which of an audience the match list can actually select: a member it
 * does not hold, or one with no WhatsApp number, cannot be shared with.
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
