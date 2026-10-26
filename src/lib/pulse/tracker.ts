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
 *
 * `shareId` is the share-instance token carried by `s=` on generic
 * (recipient-unknown) shares — it labels which share a visit came from
 * without identifying the visitor.
 *
 * A workspace member opening their own listing from the app carries
 * `internal=1`. The app's session never reaches the showcase in that
 * case (the phone's system browser, or a subdomain the dashboard
 * cookie is not sent to), so the server cannot recognise the member;
 * the tab is remembered as internal and sends nothing, and the marker
 * leaves the address bar so a copied link does not silence a buyer.
 */

import { INTERNAL_VIEW_PARAM, isInternalView } from './internal-view';
import { getShowcaseSessionKey } from './session-key';

interface PulseEvent {
  type: 'open' | 'view_property' | 'map_click' | 'gallery' | 'search';
  property_id?: string;
  metadata?: Record<string, unknown>;
}

const FLUSH_AFTER = 5;
const FLUSH_DELAY_MS = 3000;
const INTERNAL_VIEW_STORAGE = 'showcase_internal_view';

function stripInternalMarker() {
  const url = new URL(window.location.href);
  url.searchParams.delete(INTERNAL_VIEW_PARAM);
  window.history.replaceState(window.history.state, '', url.toString());
}

function isInternalTab(): boolean {
  const marked = isInternalView(window.location.search);
  try {
    if (marked) {
      window.sessionStorage.setItem(INTERNAL_VIEW_STORAGE, '1');
      stripInternalMarker();
      return true;
    }
    return window.sessionStorage.getItem(INTERNAL_VIEW_STORAGE) === '1';
  } catch {
    return marked;
  }
}

export interface ShowcaseTracker {
  track: (
    type: PulseEvent['type'],
    propertyId?: string,
    metadata?: Record<string, unknown>
  ) => void;
  flush: () => void;
}

export function createShowcaseTracker(
  accountId: string,
  visitorRef: string | null | undefined,
  shareId?: string | null,
  sellerPage?: string | null
): ShowcaseTracker {
  if (typeof window === 'undefined' || isInternalTab()) {
    return { track: () => {}, flush: () => {} };
  }

  const sessionKey = getShowcaseSessionKey();

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
          share_id: shareId || undefined,
          seller_page: sellerPage || undefined,
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
