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

function stripDeliveryFailure(text: string | null | undefined): string {
  if (!text) return '';
  const at = text.indexOf(DELIVERY_FAILURE_MARKER);
  return (at === -1 ? text : text.slice(0, at)).trim();
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
    message.sender_type !== 'customer' && forwardableText(message).length > 0
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
