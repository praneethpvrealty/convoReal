/**
 * The composer's up-front view of Meta's 24-hour customer window, shared
 * at runtime by the web thread and the mobile conversation screen. The
 * mobile app bundles this file through `@shared/`, so it must stay free
 * of imports; `src/lib/whatsapp/customer-window.ts` reads the window
 * length from here.
 */

export const CUSTOMER_WINDOW_MS = 24 * 60 * 60 * 1000;

export const CUSTOMER_WINDOW_COMPOSER_PLACEHOLDER =
  'Session expired - use a template';

export const CUSTOMER_WINDOW_COMPOSER_NOTICE =
  '24-hour session expired. Reach them another way:';

export interface CustomerSessionInfo {
  expired: boolean;
  remaining: string;
}

/**
 * Read off a thread's loaded messages: the newest customer message opens
 * the window and a thread without one is closed. Order-independent,
 * since web holds the thread oldest first and mobile newest first.
 */
export function customerSessionInfo(
  messages: readonly { sender_type: string; created_at: string }[],
  now: number = Date.now()
): CustomerSessionInfo {
  let last: number | null = null;
  for (const message of messages) {
    if (message.sender_type !== 'customer') continue;
    const at = new Date(message.created_at).getTime();
    if (Number.isNaN(at)) continue;
    if (last === null || at > last) last = at;
  }
  if (last === null)
    return { expired: true, remaining: 'No customer messages' };
  if (now - last >= CUSTOMER_WINDOW_MS) {
    return { expired: true, remaining: 'Expired' };
  }
  const hoursSince = Math.trunc((now - last) / (60 * 60 * 1000));
  return { expired: false, remaining: `${24 - hoursSince}h remaining` };
}
