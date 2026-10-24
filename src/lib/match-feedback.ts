// "Not a fit" on a listing's Matching Contacts list, and what it teaches
// the matcher. Dependency-free so the mobile bundle runs it through
// `@shared/` (SHR-003): the reasons, the type options and the rules that
// read a mark are one copy on both surfaces.

export type MatchRejectReason =
  | 'type'
  | 'budget'
  | 'location'
  | 'size'
  | 'bought_elsewhere'
  | 'not_now'
  | 'other';

export const MATCH_REJECT_REASONS: {
  reason: MatchRejectReason;
  label: string;
}[] = [
  { reason: 'type', label: 'Wrong property type' },
  { reason: 'budget', label: 'Budget' },
  { reason: 'location', label: 'Location' },
  { reason: 'size', label: 'Size' },
  { reason: 'bought_elsewhere', label: 'Already bought' },
  { reason: 'not_now', label: 'Not buying now' },
  { reason: 'other', label: 'Something else' },
];

export function isMatchRejectReason(
  value: unknown
): value is MatchRejectReason {
  return MATCH_REJECT_REASONS.some((r) => r.reason === value);
}

export function matchRejectReasonLabel(
  reason: MatchRejectReason | null | undefined
): string {
  return (
    MATCH_REJECT_REASONS.find((r) => r.reason === reason)?.label ?? 'Not a fit'
  );
}

export interface PropertyTypeOption {
  id: string;
  title: string;
  description?: string;
  /** Values written to contacts.pref_property_types — the matcher's
   *  vocabulary (TYPE_TO_GROUP in src/lib/matching.ts). */
  types: string[];
  /** Values written to contacts.pref_property_categories. */
  categories?: string[];
  /** The matcher's subtype groups this option stands for. */
  groups: string[];
  /** Offered to staff only, never in the buyer's WhatsApp type list. */
  staffOnly?: boolean;
}

export const PROPERTY_TYPE_OPTIONS: PropertyTypeOption[] = [
  {
    id: 'pt_plot',
    title: 'Residential Plot',
    types: ['Residential Land/ Plot'],
    groups: ['residential-plot'],
  },
  {
    id: 'pt_apartment',
    title: 'Flat / Apartment',
    types: ['Flat/ Apartment'],
    groups: ['apartment'],
  },
  {
    id: 'pt_house',
    title: 'House / Villa',
    types: ['Residential House', 'Villa'],
    groups: ['house'],
  },
  {
    id: 'pt_commspace',
    title: 'Commercial Space',
    description: 'Office, shop, showroom or building',
    types: ['Commercial Office Space', 'Commercial Shop'],
    groups: ['commercial-space'],
  },
  {
    id: 'pt_commplot',
    title: 'Commercial Plot',
    types: ['Commercial Plot'],
    groups: ['commercial-plot'],
  },
  {
    id: 'pt_commland',
    title: 'Commercial Land',
    types: ['Commercial Land'],
    groups: ['commercial-plot'],
  },
  {
    id: 'pt_agri',
    title: 'Agricultural Land',
    description: 'Farmland',
    types: ['Agricultural Land'],
    groups: ['agricultural'],
  },
  {
    id: 'pt_industrial',
    title: 'Industrial',
    types: ['Industrial Land', 'Industrial Building'],
    groups: ['industrial'],
  },
  {
    id: 'pt_land',
    title: 'Any land / plot',
    description: 'A site, not a building',
    types: [],
    categories: ['plot'],
    groups: ['residential-plot', 'commercial-plot', 'agricultural'],
    staffOnly: true,
  },
];

/** The type list staff pick from: one row per kind, so Commercial Land
 *  (the same group as Commercial Plot) is left to the buyer's list. */
export const STAFF_PROPERTY_TYPE_OPTIONS = PROPERTY_TYPE_OPTIONS.filter(
  (o) => o.id !== 'pt_commland'
);

export function propertyTypeOption(
  id: string | null | undefined
): PropertyTypeOption | undefined {
  return PROPERTY_TYPE_OPTIONS.find((o) => o.id === id);
}

/**
 * The contact columns a staff type answer writes. It replaces what was
 * on file rather than adding to it: "they want a residential plot" is a
 * correction, and a legacy interest left behind (property_interests
 * still saying Commercial) would keep the listing they just ruled out.
 */
export function propertyTypePatch(optionIds: string[]): {
  pref_property_types: string[];
  pref_property_categories: string[];
  property_interests: string[];
} | null {
  const options = optionIds
    .map((id) => propertyTypeOption(id))
    .filter((o): o is PropertyTypeOption => !!o);
  if (options.length === 0) return null;
  return {
    pref_property_types: [...new Set(options.flatMap((o) => o.types))],
    pref_property_categories: [
      ...new Set(options.flatMap((o) => o.categories ?? [])),
    ],
    property_interests: [],
  };
}

export function propertyTypeNote(optionIds: string[]): string | null {
  const titles = optionIds
    .map((id) => propertyTypeOption(id)?.title)
    .filter((t): t is string => !!t);
  if (titles.length === 0) return null;
  return `Looking for ${titles.join(' or ')} only (set by agent from a "Not a fit" mark).`;
}

export interface MatchFeedbackMark {
  contactId: string;
  reason: MatchRejectReason | null;
  source: 'contact' | 'agent';
  createdAt: string;
}

/**
 * Splits a ranked match list by the rejections on file for the listing.
 * A rejected contact leaves the list, whoever said no — the buyer on
 * WhatsApp or an agent from this list — and waits under "Hidden" with
 * the reason, so a mark can be undone. The hidden list is read off the
 * marks, not the ranked rows: a contact whose saved type no longer fits
 * the listing drops out of the ranking, and must still be restorable.
 */
export function partitionMatchesByFeedback<
  T extends { contact: { id: string } },
  C extends { id: string },
>(
  rows: T[],
  marks: MatchFeedbackMark[],
  contacts: C[]
): { visible: T[]; hidden: { contact: C; feedback: MatchFeedbackMark }[] } {
  const rejected = new Set(marks.map((m) => m.contactId));
  const byId = new Map(contacts.map((c) => [c.id, c]));
  return {
    visible: rows.filter((row) => !rejected.has(row.contact.id)),
    hidden: [...marks]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .flatMap((feedback) => {
        const contact = byId.get(feedback.contactId);
        return contact ? [{ contact, feedback }] : [];
      }),
  };
}

const BUILDING_GROUPS = ['apartment', 'house', 'pg', 'commercial-space'];

/**
 * A type to offer for a contact whose type is not on file, read from
 * the "wrong type" rejections they have collected and the listings they
 * showed interest in (enquiries and "interested" answers). Nothing is
 * suggested before a contact has been ruled out at least once for type.
 *
 * Interest names the type when it points somewhere the rejections have
 * not: the most-asked-about group wins. With no interest on file, two
 * or more rejections that were all buildings say the contact wants a
 * site. Anything less conclusive suggests nothing.
 */
export function suggestPropertyTypeOption(signals: {
  rejectedGroups: string[];
  interestedGroups: string[];
}): PropertyTypeOption | null {
  const rejected = new Set(signals.rejectedGroups);
  if (rejected.size === 0) return null;

  const counts = new Map<string, number>();
  for (const group of signals.interestedGroups) {
    if (rejected.has(group)) continue;
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (top) {
    return (
      STAFF_PROPERTY_TYPE_OPTIONS.find(
        (o) => !o.staffOnly && o.groups.includes(top)
      ) ?? null
    );
  }

  const allBuildings = signals.rejectedGroups.every((g) =>
    BUILDING_GROUPS.includes(g)
  );
  if (signals.rejectedGroups.length >= 2 && allBuildings) {
    return propertyTypeOption('pt_land') ?? null;
  }
  return null;
}
