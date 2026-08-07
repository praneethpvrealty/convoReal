import type { MessageStatus, SenderType } from '@/lib/types';

/**
 * Delivery ticks for an inbox row.
 *
 * The conversations row carries no status, so each visible row reads the
 * latest message's own status. That split is what makes the cache keys
 * below load-bearing: a WhatsApp status webhook moves messages.status
 * sent → delivered → read and touches nothing else — not the
 * conversation, and not its last_message_at.
 */

/** Cache key for one row's last-message status. */
export function lastMsgStatusKey(
  conversationId: string,
  lastMessageAt: string | null | undefined
): (string | null | undefined)[] {
  return ['last-msg-status', conversationId, lastMessageAt];
}

/**
 * Key to invalidate when a messages row changes.
 *
 * It stops at the conversation id on purpose. React Query matches by
 * prefix, and a status webhook leaves last_message_at untouched, so
 * anything that pinned the timestamp would only ever match a row that
 * had already refreshed — the ticks would sit on whatever the row read
 * first, usually a single tick, while the thread showed it as read.
 */
export function lastMsgStatusInvalidationKey(
  conversationId: string | null | undefined
): string[] {
  return conversationId
    ? ['last-msg-status', conversationId]
    : ['last-msg-status'];
}

/** Ticks belong to messages we sent; an inbound one shows none. */
export function outgoingTickStatus(
  lastMsg: { sender_type: SenderType; status: MessageStatus } | null | undefined
): MessageStatus | null {
  return lastMsg && lastMsg.sender_type !== 'customer' ? lastMsg.status : null;
}
