/**
 * The delivery-failure note the status webhook appends to a failed
 * message's `content_text` (see `webhook-handler.ts`), so the thread
 * shows why a bubble never arrived.
 *
 * It is display text living inside the message body, which means any
 * feature that puts a stored message back on the wire — resending it,
 * forwarding it to someone else — has to take it off first, or the
 * recipient reads our own error report.
 *
 * `mobile/lib/message-actions.ts` mirrors the marker; the copy is
 * guarded by `@/lib/mobile-parity.test.ts`.
 */

export const DELIVERY_FAILURE_MARKER = '❌ Delivery Failed:';

/** The message as it was composed, without the appended failure note. */
export function stripDeliveryFailure(text: string | null | undefined): string {
  if (!text) return '';
  const at = text.indexOf(DELIVERY_FAILURE_MARKER);
  return (at === -1 ? text : text.slice(0, at)).trim();
}
