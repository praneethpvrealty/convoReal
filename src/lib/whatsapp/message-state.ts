/**
 * Engine-local message state — pinning, and hiding from the inbox.
 *
 * Both exist because WhatsApp does not offer them for a one-to-one
 * thread. Meta has no revoke endpoint at all, and its pin endpoint takes
 * group recipients only. So neither action changes anything on the
 * contact's phone, and every string here has to say so: an agent who
 * believes a message was recalled will say so to a customer, and be
 * wrong in a way that is expensive.
 */

/** WhatsApp's own ceiling for a group. Applied to local pins too, so the
 *  two behave alike and the pinned bar stays a bar. */
export const MAX_PINNED_PER_CONVERSATION = 3;

/** What the delete action is called wherever an agent can see it. */
export const HIDE_ACTION_LABEL = 'Delete for me';

/** Shown when hiding, so nobody reads it as a recall. */
export const HIDE_CONFIRM_MESSAGE =
  'This removes the message from your team inbox only. WhatsApp has no way to delete a message from the customer’s phone once it has been sent — their copy stays.';

export interface PinnableMessage {
  id: string;
  pinned_at?: string | null;
  deleted_at?: string | null;
}

/** Whether another pin would exceed the cap. */
export function canPinMore(pinnedCount: number): boolean {
  return pinnedCount < MAX_PINNED_PER_CONVERSATION;
}

/** The messages a thread should render: hidden ones drop out entirely. */
export function visibleMessages<T extends { deleted_at?: string | null }>(
  messages: T[],
): T[] {
  return messages.filter((m) => !m.deleted_at);
}

/**
 * Pinned messages for the bar above a thread, newest pin first and
 * capped at what the cap allows — a row pinned before the limit existed
 * should not make the bar unbounded.
 */
export function pinnedMessages<
  T extends { pinned_at?: string | null; deleted_at?: string | null },
>(messages: T[]): T[] {
  return messages
    .filter((m) => m.pinned_at && !m.deleted_at)
    .sort((a, b) => (b.pinned_at ?? '').localeCompare(a.pinned_at ?? ''))
    .slice(0, MAX_PINNED_PER_CONVERSATION);
}

/** The action a tap on an already-pinned message should send. */
export function pinAction(message: PinnableMessage): 'pin' | 'unpin' {
  return message.pinned_at ? 'unpin' : 'pin';
}
