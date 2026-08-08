/**
 * Derived "who is waiting on me?" state for an inbox row.
 *
 * `conversations.awaiting_reply` is maintained server-side (true on
 * every inbound customer message, false on any outbound send), and
 * `status = 'pending'` is the chatbot's explicit hand-off flag. Either
 * one means a human should answer this thread; this module turns that
 * plus `last_customer_message_at` into what the inbox renders: how long
 * the customer has been waiting and whether Meta's 24-hour free-form
 * window is still open.
 *
 * `mobile/lib/reply-state.ts` mirrors this module; the mobile app is a
 * separate Expo project and cannot import from src/. Divergence is
 * caught by `@/lib/mobile-parity.test.ts`.
 */

import { CUSTOMER_WINDOW_MS } from './customer-window';

export interface ReplyQueueFields {
  status: string;
  awaiting_reply?: boolean | null;
  last_customer_message_at?: string | null;
  is_archived?: boolean;
}

export interface ReplyState {
  /** How long the customer has been waiting since their last message. */
  waitingMs: number;
  /** Time left in Meta's 24-hour free-form window; 0 once it has closed. */
  windowRemainingMs: number;
  /** Closed window: free-form is refused, only a template can answer. */
  windowExpired: boolean;
}

/**
 * Non-null when this thread is waiting on a human reply. Closed and
 * archived threads never need one; a thread with no customer timestamp
 * (e.g. a portal lead that has not written on WhatsApp yet) counts as
 * outside the window, matching `isWithinCustomerWindow`.
 */
export function needsReply(
  conversation: ReplyQueueFields,
  now: number = Date.now()
): ReplyState | null {
  if (conversation.is_archived || conversation.status === 'closed') return null;
  if (!conversation.awaiting_reply && conversation.status !== 'pending')
    return null;
  const at = conversation.last_customer_message_at
    ? new Date(conversation.last_customer_message_at).getTime()
    : NaN;
  if (Number.isNaN(at)) {
    return { waitingMs: 0, windowRemainingMs: 0, windowExpired: true };
  }
  const waitingMs = Math.max(0, now - at);
  const windowRemainingMs = Math.max(0, CUSTOMER_WINDOW_MS - waitingMs);
  return {
    waitingMs,
    windowRemainingMs,
    windowExpired: windowRemainingMs === 0,
  };
}

/** Compact duration for pills: "now", "5m", "3h", "2d". */
export function waitingShort(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Pill copy for a thread that needs a reply. */
export function needsReplyLabel(state: ReplyState): string {
  if (state.windowExpired) return 'Needs reply · template only';
  return `Needs reply · ${waitingShort(state.waitingMs)}`;
}
