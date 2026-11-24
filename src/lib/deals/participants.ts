/**
 * The people on a deal, as the deal form sees them: contacts, each a
 * buyer, a seller or an agent. They are stored as `deal_stakeholders`
 * rows linked to the contact, so the Stakeholders tab, share links
 * and co-broking read the same people.
 *
 * Import-free: the mobile app loads this file through `@shared/`.
 */

export type DealParticipantRole = 'buyer' | 'seller' | 'agent';

export const DEAL_PARTICIPANT_ROLES: readonly DealParticipantRole[] = [
  'buyer',
  'seller',
  'agent',
];

export const DEAL_PARTICIPANT_ROLE_LABELS: Record<DealParticipantRole, string> =
  {
    buyer: 'Buyer',
    seller: 'Seller',
    agent: 'Agent',
  };

export const MAX_DEAL_PARTICIPANTS = 12;

export interface DealParticipantInput {
  contact_id: string;
  role: DealParticipantRole;
}

export function isDealParticipantRole(v: unknown): v is DealParticipantRole {
  return (
    typeof v === 'string' &&
    (DEAL_PARTICIPANT_ROLES as readonly string[]).includes(v)
  );
}

/** How a participant is written to `deal_stakeholders`. */
export function stakeholderFieldsForParticipant(role: DealParticipantRole): {
  role: 'buyer' | 'seller' | 'broker';
  side: 'buyer' | 'seller' | 'internal';
} {
  if (role === 'seller') return { role: 'seller', side: 'seller' };
  if (role === 'agent') return { role: 'broker', side: 'internal' };
  return { role: 'buyer', side: 'buyer' };
}

/** The form role of a stored stakeholder; null for the roles the deal
 *  form does not manage (advocate, banker, witness, other). */
export function participantRoleForStakeholder(
  role: string | null | undefined
): DealParticipantRole | null {
  if (role === 'buyer' || role === 'seller') return role;
  if (role === 'broker') return 'agent';
  return null;
}

/** The role a contact most likely plays, from how it is classified.
 *  The owner of the deal's property is the seller whatever the
 *  classification says. */
export function participantRoleForContact(
  classification: string | null | undefined,
  isPropertyOwner = false
): DealParticipantRole {
  if (isPropertyOwner) return 'seller';
  switch (classification) {
    case 'Agent':
      return 'agent';
    case 'Owner':
    case 'Seller':
    case 'Developer':
      return 'seller';
    default:
      return 'buyer';
  }
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** The `participants` body of POST /api/deals. A contact listed twice
 *  keeps its first role. */
export function parseDealParticipants(
  raw: unknown
): ParseResult<DealParticipantInput[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, error: "'participants' must be a list" };
  }
  const seen = new Set<string>();
  const value: DealParticipantInput[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, error: 'Each participant needs a contact and role' };
    }
    const { contact_id: contactId, role } = entry as Record<string, unknown>;
    if (typeof contactId !== 'string' || !contactId.trim()) {
      return { ok: false, error: 'Each participant needs a contact' };
    }
    if (!isDealParticipantRole(role)) {
      return {
        ok: false,
        error: 'A participant is a buyer, a seller or an agent',
      };
    }
    const id = contactId.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    value.push({ contact_id: id, role });
  }
  if (value.length > MAX_DEAL_PARTICIPANTS) {
    return {
      ok: false,
      error: `A deal takes up to ${MAX_DEAL_PARTICIPANTS} contacts`,
    };
  }
  return { ok: true, value };
}

/** The contact stored on the deal itself: the one the caller named,
 *  else the first buyer, else the first person listed. */
export function primaryContactId(
  participants: readonly DealParticipantInput[],
  named?: string | null
): string | null {
  if (named) return named;
  return (
    participants.find((p) => p.role === 'buyer')?.contact_id ??
    participants[0]?.contact_id ??
    null
  );
}

/** The stakeholder rows a new deal starts with. A lone buyer is
 *  simply the deal's contact, as it always was; rows are written once
 *  the deal has several people or its contact is not the buyer. */
export function participantsToStore(
  participants: readonly DealParticipantInput[]
): DealParticipantInput[] {
  if (participants.length === 1 && participants[0].role === 'buyer') return [];
  return [...participants];
}

export interface EventForDeal {
  title?: string | null;
  contact_id?: string | null;
  contact_ids?: readonly string[] | null;
  property_id?: string | null;
}

export function eventContactIds(event: EventForDeal): string[] {
  const ids = event.contact_ids?.length
    ? [...event.contact_ids]
    : event.contact_id
      ? [event.contact_id]
      : [];
  return [...new Set(ids)];
}

/** The people a deal opened from a calendar event starts with: every
 *  contact on the event, each with a role guessed from the contact. */
export function participantsFromEvent(
  event: EventForDeal,
  contacts: readonly { id: string; classification?: string | null }[],
  propertyOwnerContactId?: string | null
): DealParticipantInput[] {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  return eventContactIds(event)
    .filter((id) => byId.has(id))
    .slice(0, MAX_DEAL_PARTICIPANTS)
    .map((id) => ({
      contact_id: id,
      role: participantRoleForContact(
        byId.get(id)?.classification,
        Boolean(propertyOwnerContactId) && id === propertyOwnerContactId
      ),
    }));
}

/** A starting title for a deal opened from an event: the property and
 *  the first buyer, else the event's own title. */
export function dealTitleFromEvent(input: {
  eventTitle?: string | null;
  propertyTitle?: string | null;
  contactName?: string | null;
}): string {
  const property = input.propertyTitle?.trim();
  const contact = input.contactName?.trim();
  if (property && contact) return `${property} — ${contact}`;
  return property || input.eventTitle?.trim() || contact || '';
}

export interface DealForEvent {
  id: string;
  contact_id: string | null;
  property_id: string | null;
  status?: string | null;
  updated_at?: string | null;
}

/**
 * Deals worth offering for an event, best first: same property and a
 * shared contact, then the same property, then a shared contact. A
 * deal that shares nothing with the event scores 0 and is left out of
 * the suggestions (search still finds it). Open deals come before
 * closed ones at the same score.
 */
export function dealMatchScore(
  deal: DealForEvent,
  event: EventForDeal,
  dealContactIds: readonly string[] = []
): number {
  const contacts = new Set(eventContactIds(event));
  const sharesContact =
    (deal.contact_id !== null && contacts.has(deal.contact_id)) ||
    dealContactIds.some((id) => contacts.has(id));
  const sameProperty =
    Boolean(event.property_id) && deal.property_id === event.property_id;
  return (sameProperty ? 2 : 0) + (sharesContact ? 1 : 0);
}

export function suggestDealsForEvent<T extends DealForEvent>(
  deals: readonly T[],
  event: EventForDeal,
  stakeholderContacts: Readonly<Record<string, readonly string[]>> = {}
): T[] {
  return deals
    .map((deal) => ({
      deal,
      score: dealMatchScore(deal, event, stakeholderContacts[deal.id]),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aOpen = (a.deal.status ?? 'open') === 'open' ? 1 : 0;
      const bOpen = (b.deal.status ?? 'open') === 'open' ? 1 : 0;
      if (bOpen !== aOpen) return bOpen - aOpen;
      return (b.deal.updated_at ?? '').localeCompare(a.deal.updated_at ?? '');
    })
    .map((row) => row.deal);
}
