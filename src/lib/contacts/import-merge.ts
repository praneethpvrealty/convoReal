// What an import may change on a contact the account already holds.
//
// A re-engagement list overlaps the book it came from, so most rows in
// a portal export match someone already on file. Inserting them again
// gives one person two contact rows and two copies of the same message,
// so the import updates instead — but a portal export is thinner than
// what an agent has built up by hand, and letting it overwrite would
// lose the better data.
//
// Hence: fill blanks only. The single exception is the enquired
// property, which is the freshest fact the file carries and the one
// that makes a re-engagement message specific.

export interface ExistingContactFields {
  name: string | null;
  name_tag: string | null;
  email: string | null;
  company: string | null;
  min_budget: number | null;
  max_budget: number | null;
  areas_of_interest: string[] | null;
  last_inquired_property_id: string | null;
}

export interface IncomingContactFields {
  name: string | null;
  name_tag: string | null;
  email: string | null;
  company: string | null;
  min_budget: number | null;
  max_budget: number | null;
  areas_of_interest: string[];
  last_inquired_property_id: string | null;
}

/**
 * The patch to apply, or an empty object when the file adds nothing.
 * Callers skip the write entirely when nothing comes back.
 */
export function buildExistingContactPatch(
  existing: ExistingContactFields,
  incoming: IncomingContactFields
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  for (const field of ['name', 'name_tag', 'email', 'company'] as const) {
    const value = incoming[field];
    if (value && !existing[field]) patch[field] = value;
  }

  for (const field of ['min_budget', 'max_budget'] as const) {
    const value = incoming[field];
    if (value !== null && existing[field] == null) patch[field] = value;
  }

  if (
    incoming.areas_of_interest.length > 0 &&
    (existing.areas_of_interest ?? []).length === 0
  ) {
    patch.areas_of_interest = incoming.areas_of_interest;
  }

  // Always taken when present: which listing the lead enquired about is
  // what the anchored message names, and a newer enquiry supersedes an
  // older one.
  if (incoming.last_inquired_property_id) {
    patch.last_inquired_property_id = incoming.last_inquired_property_id;
  }

  return patch;
}
