/**
 * How a contact can be reached.
 *
 * `contacts.phone` is nullable from migration 253 on — a company
 * mailbox with no number is a legitimate contact — so anything that
 * dials, opens WhatsApp or shares has to ask rather than assume.
 *
 * Mirrors src/lib/contacts/reachability.ts. Only types cross the
 * @shared alias, so the few lines are restated here rather than
 * pulled through Metro.
 */

export interface Reachable {
  phone?: string | null;
  email?: string | null;
}

export function hasPhone<T extends Reachable>(
  contact: T
): contact is T & { phone: string } {
  return typeof contact.phone === 'string' && contact.phone.trim().length > 0;
}

export function hasEmail<T extends Reachable>(
  contact: T
): contact is T & { email: string } {
  return typeof contact.email === 'string' && contact.email.trim().length > 0;
}

/** What to show where a number used to be printed unconditionally —
 *  the email for an email-only contact, so the row still identifies
 *  itself. */
export function contactHandle(contact: Reachable): string {
  if (hasPhone(contact)) return contact.phone.trim();
  if (hasEmail(contact)) return contact.email.trim();
  return '';
}
