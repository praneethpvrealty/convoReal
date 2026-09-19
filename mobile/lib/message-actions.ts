// What a single message in a thread can be acted on with, and how it is
// described once it leaves its bubble — the quote above the composer,
// the forward confirmation, the result of forwarding to several people.
//
// Kept transport-free so the conversation screen stays a renderer: the
// rules here are the ones worth being sure about.

import type { Message } from '@/lib/types';

/** Longest quote preview kept before an ellipsis. */
const PREVIEW_LIMIT = 120;

/**
 * The note the status webhook appends to a failed message's body so the
 * thread shows why it never arrived. It is ours, not the agent's: text
 * going back on the wire has to have it removed first.
 *
 * Mirrors `src/lib/whatsapp/delivery-failure.ts` in the web repo, which
 * the mobile app cannot import from; the copy is guarded by that repo's
 * `mobile-parity.test.ts`.
 */
const DELIVERY_FAILURE_MARKER = '❌ Delivery Failed:';
export const META_MARKETING_FREQUENCY_ERROR = 131049;
const MARKETING_SUPPRESSION_MS = 24 * 60 * 60 * 1000;
const MARKETING_SUPPRESSION_MESSAGE =
  'WhatsApp temporarily limited marketing messages to this contact. Wait until the cooldown ends or until the contact replies.';

export function stripDeliveryFailure(text: string | null | undefined): string {
  if (!text) return '';
  const at = text.indexOf(DELIVERY_FAILURE_MARKER);
  return (at === -1 ? text : text.slice(0, at)).trim();
}

function errorCode(message: Message): number | null {
  if (message.error_code) return message.error_code;
  const source = `${message.error_info ?? ''}\n${message.content_text ?? ''}`;
  const match = source.match(/(?:Error|error|#)\s*(\d{5,6})/);
  return match ? Number(match[1]) : null;
}

function retryAfter(message: Message): string | null {
  if (message.retry_after) return message.retry_after;
  if (errorCode(message) !== META_MARKETING_FREQUENCY_ERROR) return null;
  const created = new Date(message.created_at);
  return Number.isNaN(created.getTime())
    ? null
    : new Date(created.getTime() + MARKETING_SUPPRESSION_MS).toISOString();
}

export function canRetryDeliveryFailure(
  message: Message,
  now: Date = new Date()
): boolean {
  if (
    message.status !== 'failed' ||
    errorCode(message) !== META_MARKETING_FREQUENCY_ERROR
  ) {
    return true;
  }
  const at = retryAfter(message);
  return Boolean(at && new Date(at).getTime() <= now.getTime());
}

export function deliveryFailurePresentation(
  message: Message,
  now: Date = new Date()
): {
  title: string;
  detail: string;
  retryAt: string | null;
  canRetry: boolean;
} | null {
  if (message.status !== 'failed') return null;
  if (errorCode(message) === META_MARKETING_FREQUENCY_ERROR) {
    const canRetry = canRetryDeliveryFailure(message, now);
    return {
      title: 'Not delivered — WhatsApp marketing limit',
      detail: canRetry
        ? 'The cooldown has ended. You can try once, or wait for the contact to reply.'
        : MARKETING_SUPPRESSION_MESSAGE,
      retryAt: retryAfter(message),
      canRetry,
    };
  }
  return {
    title: 'Delivery failed',
    detail: message.error_info || 'WhatsApp could not deliver this message.',
    retryAt: message.retry_after ?? null,
    canRetry: true,
  };
}

const MEDIA_LABELS: Record<string, string> = {
  image: 'Photo',
  video: 'Video',
  audio: 'Voice message',
  document: 'Document',
  location: 'Location',
  template: 'Template',
  interactive: 'Interactive message',
};

/**
 * One-line description of a message, for a reply quote or a forward
 * confirmation. Media rows carry no text, so they name their kind
 * instead of coming out blank.
 */
export function messagePreview(
  message: Message,
  limit: number = PREVIEW_LIMIT
): string {
  const text = stripDeliveryFailure(message.content_text).replace(/\s+/g, ' ');
  if (!text) return MEDIA_LABELS[message.content_type] ?? 'Message';
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}

/** Who wrote the quoted message, from the reader's side of the thread. */
export function messageAuthorLabel(
  message: Message,
  contactName?: string | null
): string {
  if (message.sender_type !== 'customer') return 'You';
  return contactName?.trim() || 'Them';
}

/** Text we can put back on the wire — the message as it was composed,
 *  without the delivery-failure note. Media has none: an outgoing row
 *  holds a storage URL and an inbound one a Meta media id, and neither
 *  survives being re-sent as-is. */
export function forwardableText(message: Message): string {
  return stripDeliveryFailure(message.content_text);
}

export function canForward(message: Message): boolean {
  return forwardableText(message).length > 0;
}

/** Only our own messages can be sent again — "resending" something the
 *  contact wrote would put their words in our voice. */
export function canResend(message: Message): boolean {
  return (
    message.sender_type !== 'customer' &&
    forwardableText(message).length > 0 &&
    canRetryDeliveryFailure(message)
  );
}

export interface ForwardResult {
  contact_id: string;
  name: string;
  sent: boolean;
  window_closed?: boolean;
  error?: string;
}

/**
 * What to tell the agent after a forward. Everything delivered needs no
 * dialog at all (null) — the failures are the news, and a contact who
 * hasn't written in 24 hours is a different failure from a broken send.
 */
export function forwardSummary(
  results: ForwardResult[]
): { title: string; message: string } | null {
  const sent = results.filter((r) => r.sent);
  if (sent.length === results.length) return null;

  const blocked = results
    .filter((r) => !r.sent && r.window_closed)
    .map((r) => r.name);
  const failed = results
    .filter((r) => !r.sent && !r.window_closed)
    .map((r) => r.name);

  return {
    title:
      sent.length === 0
        ? 'Nothing was forwarded'
        : `Forwarded to ${sent.length} of ${results.length}`,
    message: [
      blocked.length
        ? `No message in the last 24 hours, so WhatsApp needs an approved template for: ${blocked.join(', ')}. Open their chat to send one.`
        : null,
      failed.length ? `Could not send to: ${failed.join(', ')}.` : null,
    ]
      .filter(Boolean)
      .join('\n\n'),
  };
}
