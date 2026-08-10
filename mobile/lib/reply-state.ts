/**
 * Derived "who is waiting on me?" state for an inbox row.
 *
 * Mirror of `src/lib/whatsapp/reply-state.ts` — this app cannot import
 * from src/, and divergence is caught by the web repo's
 * `src/lib/mobile-parity.test.ts`.
 */

import { CUSTOMER_WINDOW_MS } from '@/lib/customer-window';

export interface ReplyQueueFields {
  status: string;
  awaiting_reply?: boolean | null;
  last_customer_message_at?: string | null;
  last_message_at?: string | null;
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

/**
 * How long a thread stays merely "sent" before it reads as unanswered.
 * Without it every thread an agent just messaged would immediately
 * claim the contact ignored them, which after a broadcast is most of
 * the inbox.
 */
export const UNANSWERED_GRACE_MS = 60 * 60 * 1000;

export interface UnansweredState {
  /** How long our side has been talking to itself. */
  silentMs: number;
}

/**
 * Non-null when we have written and the contact never has — the lead
 * that went nowhere, as opposed to `needsReply`'s thread that owes
 * somebody an answer. The two are mutually exclusive by construction.
 *
 * A null `last_customer_message_at` is exactly this population: the
 * column is only ever stamped by an inbound WhatsApp message, so a
 * portal lead the bot auto-replied to and outreach that landed on
 * silence both qualify, and one message back clears it for good.
 */
export function unanswered(
  conversation: ReplyQueueFields,
  now: number = Date.now()
): UnansweredState | null {
  if (needsReply(conversation, now)) return null;
  if (conversation.is_archived || conversation.status === 'closed') return null;
  if (conversation.last_customer_message_at) return null;
  const at = conversation.last_message_at
    ? new Date(conversation.last_message_at).getTime()
    : NaN;
  if (Number.isNaN(at)) return null;
  const silentMs = Math.max(0, now - at);
  if (silentMs < UNANSWERED_GRACE_MS) return null;
  return { silentMs };
}

/** Pill copy for a thread the contact has never answered. */
export function unansweredLabel(state: UnansweredState): string {
  return `Unanswered · ${waitingShort(state.silentMs)}`;
}
