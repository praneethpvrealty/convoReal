/**
 * Showcase Pulse client tracker (browser-only).
 *
 * Batches engagement events from the public showcase and beacons them to
 * /api/public/showcase-events. Fire-and-forget by design: tracking must
 * never affect the showcase UX, so every failure path is swallowed.
 *
 * `visitorRef` is the contact id carried by the `v=` query param on
 * per-contact share links (Radar sends, bot property shares). It is
 * deliberately a different param from `ref=`, which the showcase server
 * uses to FILTER the catalog to a referrer's own listings — a buyer
 * identity must never narrow what the buyer sees.
 */

interface PulseEvent {
  type: 'open' | 'view_property' | 'map_click' | 'gallery';
  property_id?: string;
  metadata?: Record<string, unknown>;
}

const SESSION_KEY_STORAGE = 'showcase_session_key';
const FLUSH_AFTER = 5;
const FLUSH_DELAY_MS = 3000;

export interface ShowcaseTracker {
  track: (type: PulseEvent['type'], propertyId?: string, metadata?: Record<string, unknown>) => void;
  flush: () => void;
}

export function createShowcaseTracker(
  accountId: string,
  visitorRef: string | null | undefined
): ShowcaseTracker {
  if (typeof window === 'undefined') {
    return { track: () => {}, flush: () => {} };
  }

  let sessionKey: string;
  try {
    sessionKey = localStorage.getItem(SESSION_KEY_STORAGE) || '';
    if (!sessionKey) {
      sessionKey = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY_STORAGE, sessionKey);
    }
  } catch {
    // Storage blocked (private mode) — ephemeral per-page session
    sessionKey = crypto.randomUUID();
  }

  let queue: PulseEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush() {
    if (queue.length === 0) return;
    const events = queue;
    queue = [];
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    try {
      // keepalive lets the final batch survive tab close / navigation
      void fetch('/api/public/showcase-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          account_id: accountId,
          session_key: sessionKey,
          ref: visitorRef || undefined,
          events,
        }),
      }).catch(() => {});
    } catch {
      // never let tracking break the showcase
    }
  }

  function track(
    type: PulseEvent['type'],
    propertyId?: string,
    metadata?: Record<string, unknown>
  ) {
    queue.push({ type, property_id: propertyId, metadata });
    if (queue.length >= FLUSH_AFTER) {
      flush();
    } else if (!timer) {
      timer = setTimeout(flush, FLUSH_DELAY_MS);
    }
  }

  const onHide = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flush);

  return { track, flush };
}
