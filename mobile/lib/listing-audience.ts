import { apiFetch } from '@/lib/api';
import { setPropertyMatchAudienceOverlay } from '@/lib/property-matches';
import type {
  AudienceContact,
  AudienceListing,
} from '@shared/lib/inventory/listing-audience';

/**
 * Web parity: ListingAudiencePicker. The contacts who engaged with a
 * listing — enquiries and identified showcase views — so a new listing
 * can go out to everyone who chased a comparable one in a single tap.
 * The aggregation runs in Postgres behind /api/properties, so both
 * surfaces select the same people.
 */
export type { AudienceContact, AudienceListing };
export {
  audienceListingLabel,
  filterAudienceListings,
  reachableAudienceIds,
} from '@/lib/listing-audience-select';

export async function fetchAudienceListings(): Promise<AudienceListing[]> {
  const { data } = await apiFetch<{ data: AudienceListing[] }>(
    '/api/properties/audiences'
  );
  return data ?? [];
}

export async function fetchListingAudience(
  propertyId: string
): Promise<AudienceContact[]> {
  const { data } = await apiFetch<{ data: AudienceContact[] }>(
    `/api/properties/${propertyId}/audience`
  );
  const audience = data ?? [];
  // Historical engagement must remain actionable even when those contacts
  // are not part of the current property's preference-ranked match list.
  // The overlay is scoped to the active property-match query and lets the
  // existing selection/share UI render the exact audience returned here.
  setPropertyMatchAudienceOverlay(audience);
  return audience;
}
