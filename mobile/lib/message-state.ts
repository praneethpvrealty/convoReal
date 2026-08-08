// Pinning a message, and hiding one from the inbox.
//
// Mirror of src/lib/whatsapp/message-state.ts in the web repo, which the
// mobile app cannot import from; the copy is guarded by that repo's
// mobile-parity.test.ts.
//
// NEITHER REACHES WHATSAPP. Meta has no revoke endpoint — a sent message
// cannot be deleted from the contact's phone by anyone using the
// official API — and its pin endpoint accepts group recipients only. So
// hiding is local to this account's inbox and pinning is a marker for
// the team. Every string an agent can read has to say so.

import type { Message } from '@/lib/types';

/** WhatsApp's own ceiling for a group, applied to local pins too. */
export const MAX_PINNED_PER_CONVERSATION = 3;

export const HIDE_ACTION_LABEL = 'Delete for me';

export const HIDE_CONFIRM_MESSAGE =
  'This removes the message from your team inbox only. WhatsApp has no way to delete a message from the customer’s phone once it has been sent — their copy stays.';

/** The messages a thread should render. */
export function visibleMessages(messages: Message[]): Message[] {
  return messages.filter((m) => !m.deleted_at);
}

/** Pinned messages for the bar above the thread, newest pin first. */
export function pinnedMessages(messages: Message[]): Message[] {
  return messages
    .filter((m) => m.pinned_at && !m.deleted_at)
    .sort((a, b) => (b.pinned_at ?? '').localeCompare(a.pinned_at ?? ''))
    .slice(0, MAX_PINNED_PER_CONVERSATION);
}

/** The action a tap should send for this message's current state. */
export function pinAction(message: Message): 'pin' | 'unpin' {
  return message.pinned_at ? 'unpin' : 'pin';
}

/** Whether the thread has room for another pin. */
export function canPinMore(pinnedCount: number): boolean {
  return pinnedCount < MAX_PINNED_PER_CONVERSATION;
}
