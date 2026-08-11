// How a contact can be reached. Phone is optional from migration 252
// on — a company mailbox with no number is a legitimate contact — so
// anything that messages over WhatsApp has to ask rather than assume.

export interface Reachable {
  phone?: string | null;
  email?: string | null;
}

/** True when the contact has a number WhatsApp can deliver to. Narrows
 *  the type, so a guarded branch may pass `contact.phone` on as a
 *  plain string. */
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

/** A contact must keep at least one channel — the DB enforces the same
 *  rule as `contacts_phone_or_email`. */
export function isReachable(contact: Reachable): boolean {
  return hasPhone(contact) || hasEmail(contact);
}

/** What to show where a phone number used to be printed unconditionally
 *  — the email for an email-only contact, so the row still identifies
 *  itself. */
export function contactHandle(contact: Reachable): string {
  if (hasPhone(contact)) return contact.phone.trim();
  if (hasEmail(contact)) return contact.email.trim();
  return '';
}
