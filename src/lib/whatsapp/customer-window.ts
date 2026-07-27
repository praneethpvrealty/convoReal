/**
 * Meta's 24-hour customer service window.
 *
 * Free-form text may only be sent within 24 hours of the contact's last
 * inbound message; outside it Meta rejects the send and the account must
 * re-engage with an approved template. Both halves of that rule — the
 * local window check and the recognition of Meta's rejection — were
 * inlined as magic strings at four call sites (twice in
 * contact-detail-view.tsx, twice in mobile/), each free to drift.
 *
 * `mobile/lib/customer-window.ts` mirrors this module; the mobile app is
 * a separate Expo project and cannot import from src/. Divergence is
 * caught by `@/lib/mobile-parity.test.ts`.
 */

export const CUSTOMER_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Whether free-form text is still allowed, given when the contact last
 * messaged in. A contact who has never messaged (null) is outside the
 * window — the first outbound must be a template.
 */
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
 * window — the caller's cue to fall back to template selection rather
 * than showing a generic failure.
 *
 * 131047 is Meta's "Re-engagement message" error code; the text matches
 * cover our own pre-flight throw and the human-readable variants Meta
 * returns alongside the code.
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

/** Thrown pre-flight when the window has closed, so the caller's
 *  `isReengagementError` branch handles it identically to Meta's own
 *  rejection. */
export const CUSTOMER_WINDOW_EXPIRED_MESSAGE =
  'WhatsApp session has expired (over 24 hours). Re-engagement message must be sent via template.';
