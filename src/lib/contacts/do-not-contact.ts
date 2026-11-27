/**
 * Do not contact — an agent's standing instruction that nothing is sent
 * to this person: no WhatsApp message (an agent typing in the inbox
 * included), no bot reply, no digest, no reminder, no call.
 *
 * Not the same as dead (src/lib/contacts/lifecycle.ts). A dead lead has
 * ended their search, so they leave matching and an agent may still
 * answer them by hand. A do-not-contact person is still a live record —
 * the owner of a listing the brokerage markets, a buyer handled
 * personally by a partner — so matching and listings carry on, and only
 * communication stops, all of it.
 *
 * Dependency-free so the mobile app imports the same wording through
 * `@shared/` rather than keeping a copy.
 */

export const DO_NOT_CONTACT_LABEL = 'Do not contact';

/** Thrown by the dispatcher for every send to a do-not-contact person. */
export const DO_NOT_CONTACT_BLOCKED_MESSAGE =
  'This contact is marked Do not contact — nothing can be sent to them. Turn it off on the contact first if you need to reach them.';

/** What an agent sees above the composer on such a contact's thread. */
export const DO_NOT_CONTACT_NOTICE =
  'Marked Do not contact. Messages, replies, digests, reminders and calls to this person are all blocked. Their incoming messages still arrive here.';

/** The line under the switch on the contact form. */
export const DO_NOT_CONTACT_HINT =
  'Nothing is sent to this person — no WhatsApp message (including replies from the inbox), no bot reply, digest, reminder, broadcast or call. They still match properties and stay on their listings.';

export const DO_NOT_CONTACT_REASON_MAX = 200;

export interface DoNotContactFields {
  do_not_contact?: boolean | null;
}

export function isDoNotContact(
  contact: DoNotContactFields | null | undefined
): boolean {
  return contact?.do_not_contact === true;
}

export function normaliseDoNotContactReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const flat = raw.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.slice(0, DO_NOT_CONTACT_REASON_MAX);
}

/** The audit line written to contact_notes on every change. */
export function doNotContactNote(
  enabled: boolean,
  reason: string | null
): string {
  if (!enabled)
    return 'Do not contact turned off — messages and calls allowed again.';
  return reason ? `Marked Do not contact: ${reason}` : 'Marked Do not contact.';
}
