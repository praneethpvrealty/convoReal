import type { Message } from '@/lib/types';

/**
 * Bubbles that exist on screen before they exist in the database.
 *
 * A send used to render nothing until the API answered — a WhatsApp
 * round trip, so a second or more on mobile data — which read as the
 * message having been swallowed. The composer now posts the bubble
 * first with status 'sending' (the hourglass), moves it to 'sent' (one
 * tick) when WhatsApp accepts it, and lets the real row arriving over
 * realtime carry it the rest of the way: 'delivered' (two ticks) and
 * 'read' (two blue ticks) come from Meta's status webhooks.
 *
 * The catch is that the row is written server-side by the dispatcher,
 * so the client never learns its id and cannot match on one. It matches
 * on what was sent instead.
 */

/** Types whose identity is the file, not the words around it. */
const MEDIA_TYPES = new Set(['image', 'document', 'audio', 'video']);

/**
 * What makes two outgoing messages "the same send".
 *
 * Media keys on the uploaded path rather than the caption: captions are
 * usually empty, so two photos sent back to back would otherwise share
 * a signature and the first row to land would retire both bubbles. The
 * upload path is unique per file, so it cannot collide. It is also why
 * the caller patches `media_url` onto the pending bubble only once the
 * upload returns — before that the bubble carries no path and no real
 * row can match it.
 */
export function outgoingSignature(
  m: Pick<Message, 'content_type' | 'content_text' | 'media_url'>
): string {
  if (MEDIA_TYPES.has(m.content_type)) {
    return `${m.content_type}:${m.media_url ?? ''}`;
  }
  return `${m.content_type}:${(m.content_text ?? '').trim()}`;
}

/**
 * The pending bubbles still worth showing — those the thread has not
 * caught up with yet.
 *
 * Only outgoing messages can retire a pending bubble: a customer who
 * happens to echo our exact wording back is not our send landing.
 */
export function settlePending(pending: Message[], messages: Message[]): Message[] {
  if (pending.length === 0) return pending;
  const landed = new Set(
    messages.filter((m) => m.sender_type !== 'customer').map(outgoingSignature)
  );
  return pending.filter((p) => !landed.has(outgoingSignature(p)));
}
