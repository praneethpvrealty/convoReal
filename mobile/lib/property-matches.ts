import { apiFetch } from '@/lib/api';
import type { Contact } from '@/lib/types';
import type { MatchDetails } from '@shared/lib/matching';

/**
 * Web parity: the Matching Contacts tab (src/components/inventory/
 * property-form.tsx). The ranking itself runs server-side on
 * GET /api/properties/[id]/matches so both surfaces score a listing
 * with the same engine instead of keeping a native copy of it.
 */
export interface PropertyMatch {
  contact: Contact;
  score: number;
  details: MatchDetails;
  /** When this listing was already shared with the contact, ISO — null
   *  if the communication hasn't gone out yet. */
  sharedAt: string | null;
}

export async function fetchPropertyMatches(
  propertyId: string
): Promise<PropertyMatch[]> {
  const { data } = await apiFetch<{ data: PropertyMatch[] }>(
    `/api/properties/${propertyId}/matches`
  );
  return data ?? [];
}
