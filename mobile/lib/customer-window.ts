// Port of the web's src/lib/whatsapp/customer-window.ts — Meta's
// 24-hour customer service window. Free-form text is only allowed
// within 24 hours of the contact's last inbound message; outside it
// Meta rejects the send and the account must re-engage with a template.
//
// Kept in sync by the web repo's src/lib/mobile-parity.test.ts.

export const CUSTOMER_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithinCustomerWindow(
  lastCustomerMessageAt: string | Date | null | undefined,
  now: number = Date.now()
): boolean {
  if (!lastCustomerMessageAt) return false;
  const at =
    lastCustomerMessageAt instanceof Date
      ? lastCustomerMessageAt.getTime()
      : new Date(lastCustomerMessageAt).getTime();
  if (Number.isNaN(at)) return false;
  return now - at < CUSTOMER_WINDOW_MS;
}

/**
 * Whether a failed send was Meta refusing free-form text outside the
 * window — the caller's cue to fall back to a template rather than
 * showing a generic failure. 131047 is Meta's "Re-engagement message"
 * error code.
 */
export function isReengagementError(err: unknown): boolean {
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    message.includes('131047') ||
    lower.includes('24 hours') ||
    lower.includes('re-engagement')
  );
}

export const CUSTOMER_WINDOW_EXPIRED_MESSAGE =
  'WhatsApp session has expired (over 24 hours). Re-engagement message must be sent via template.';
