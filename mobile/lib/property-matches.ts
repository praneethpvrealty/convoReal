import { apiFetch } from '@/lib/api';
import { queryClient } from '@/lib/query';
import type { Contact } from '@/lib/types';
import type { MatchDetails } from '@shared/lib/matching';
import type { InquiredProperty } from '@shared/lib/contacts/inquired-properties';
import type { AudienceContact } from '@shared/lib/inventory/listing-audience';
import type {
  MatchFeedbackMark,
  MatchRejectReason,
} from '@shared/lib/match-feedback';

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
  /** A PROPERTY_TYPE_OPTIONS id the server read off this contact's
   *  "Not a fit" marks and enquiries; set only while their type is not
   *  on file. Absent from servers that predate it. */
  suggestedType?: string | null;
}

/** A contact ruled out for this listing — by the buyer or an agent. */
export interface HiddenPropertyMatch {
  contact: Pick<
    Contact,
    'id' | 'name' | 'phone' | 'classification' | 'name_tag'
  >;
  feedback: MatchFeedbackMark;
}

export interface PropertyMatchSet {
  matches: PropertyMatch[];
  hidden: HiddenPropertyMatch[];
}

/** Ported rather than imported: `@shared/` resolves types only, so a
 *  runtime import of the web helper dies at Metro bundle time. */
export function inquiredPropertyLabel(property: InquiredProperty): string {
  const title = property.title?.trim();
  if (title && property.property_code)
    return `${title} (${property.property_code})`;
  return title || property.property_code || 'Untitled listing';
}

/**
 * A listing audience is historical engagement, not a preference match.
 * Keep it as a short-lived overlay on the property that is currently open
 * so audience members can be reviewed/selected even when they are absent
 * from the server's ranked-match response (for example after archiving the
 * source listing). The first property-match query to refresh after an
 * audience pick owns the overlay; navigating to another property will not
 * carry it across.
 */
let audienceOverlay: {
  targetPropertyId: string | null;
  contacts: AudienceContact[];
} | null = null;

export function setPropertyMatchAudienceOverlay(
  contacts: AudienceContact[]
): void {
  audienceOverlay = {
    targetPropertyId: null,
    contacts: contacts.filter((contact) => Boolean(contact.phone)),
  };
  void queryClient.invalidateQueries({ queryKey: ['property-matches'] });
}

function audienceContactToMatch(member: AudienceContact): PropertyMatch {
  const now = new Date(0).toISOString();
  return {
    contact: {
      id: member.contactId,
      // Audience rows are already account-scoped and the share flow uses
      // the contact id/phone/name; user_id and timestamps are DB-row fields
      // not consumed by this screen, but Contact requires them structurally.
      user_id: '',
      phone: member.phone,
      name: member.name ?? undefined,
      name_tag: member.nameTag,
      classification: member.classification as Contact['classification'],
      created_at: now,
      updated_at: now,
    },
    score: 0,
    details: {} as MatchDetails,
    sharedAt: null,
    inquiries: [],
  };
}

export async function fetchPropertyMatches(
  propertyId: string
): Promise<PropertyMatchSet> {
  const { data, hidden } = await apiFetch<{
    data: PropertyMatch[];
    hidden?: HiddenPropertyMatch[];
  }>(`/api/properties/${propertyId}/matches`);
  const matches = data ?? [];
  const set = { matches, hidden: hidden ?? [] };

  const overlay = audienceOverlay;
  if (!overlay || overlay.contacts.length === 0) return set;
  if (overlay.targetPropertyId === null) overlay.targetPropertyId = propertyId;
  if (overlay.targetPropertyId !== propertyId) return set;

  // A contact marked not a fit stays out even when the overlay picked
  // them: they wait under hidden like every other rejection.
  const known = new Set([
    ...matches.map((match) => match.contact.id),
    ...set.hidden.map((row) => row.contact.id),
  ]);
  const historical = overlay.contacts
    .filter((member) => !known.has(member.contactId))
    .map(audienceContactToMatch);
  return { ...set, matches: [...matches, ...historical] };
}

/** Web parity: src/lib/inventory/match-feedback-request.ts. */
export function markMatchNotAFit(
  propertyId: string,
  contactId: string,
  reason: MatchRejectReason,
  propertyTypes: string[] = []
) {
  return apiFetch<{ data: { typeSaved: boolean } }>(
    `/api/properties/${propertyId}/match-feedback`,
    {
      method: 'POST',
      body: JSON.stringify({
        action: 'reject',
        contactId,
        reason,
        propertyTypes,
      }),
    }
  );
}

export function saveMatchPropertyType(
  propertyId: string,
  contactId: string,
  propertyTypes: string[]
) {
  return apiFetch<{ data: { typeSaved: boolean } }>(
    `/api/properties/${propertyId}/match-feedback`,
    {
      method: 'POST',
      body: JSON.stringify({ action: 'set_type', contactId, propertyTypes }),
    }
  );
}

export function restoreMatch(propertyId: string, contactId: string) {
  return apiFetch<{ data: { restored: boolean } }>(
    `/api/properties/${propertyId}/match-feedback?contactId=${encodeURIComponent(contactId)}`,
    { method: 'DELETE' }
  );
}
