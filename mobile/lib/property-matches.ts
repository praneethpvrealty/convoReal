import { apiFetch } from '@/lib/api';
import type { Contact } from '@/lib/types';
import type { MatchDetails } from '@shared/lib/matching';
import type { InquiredProperty } from '@shared/lib/contacts/inquired-properties';

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
  /** The listings this contact enquired about, newest first, capped
   *  server-side. Empty when they have never asked about anything. */
  inquiries: InquiredProperty[];
}

/** Ported rather than imported: `@shared/` resolves types only, so a
 *  runtime import of the web helper dies at Metro bundle time. */
export function inquiredPropertyLabel(property: InquiredProperty): string {
  return property.property_code || property.title || 'Untitled listing';
}

export async function fetchPropertyMatches(
  propertyId: string
): Promise<PropertyMatch[]> {
  const { data } = await apiFetch<{ data: PropertyMatch[] }>(
    `/api/properties/${propertyId}/matches`
  );
  return data ?? [];
}
