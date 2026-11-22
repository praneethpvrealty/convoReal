import type { Contact, ShowcaseEvent } from '@/lib/types';

/**
 * Pure timeline logic for Showcase Pulse — web parity with
 * src/lib/pulse/dedupe-feed.ts. Kept apart from pulse.ts so it carries
 * no Supabase or Expo import and can be unit tested directly.
 */

export interface PulseEvent extends ShowcaseEvent {
  contact: Pick<Contact, 'id' | 'name' | 'phone' | 'name_tag'> | null;
  property: { id: string; title: string } | null;
  share?: { id: string; created_at: string } | null;
  via_contact?: Pick<Contact, 'id' | 'name' | 'phone'> | null;
}

/** A merged run of consecutive, near-identical events. */
export interface DedupedPulseEvent extends PulseEvent {
  repeatCount: number;
}

export interface VisitorActivityGroup {
  id: string;
  latestEvent: DedupedPulseEvent;
  events: DedupedPulseEvent[];
  activityCount: number;
}

/** Repeats within this window of each other collapse into one entry —
 *  wide enough to catch double page-loads and bfcache restores, narrow
 *  enough that a visitor genuinely returning hours later still gets its
 *  own timeline row. */
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Collapses consecutive events for the same session + event type +
 * property into a single row with a repeat count. `feed` must be sorted
 * newest-first (as fetchPulseFeed returns it) — the first event in a run
 * is the most recent, so its timestamp is what the merged row keeps.
 */
export function dedupeConsecutiveEvents(
  feed: PulseEvent[]
): DedupedPulseEvent[] {
  const result: DedupedPulseEvent[] = [];

  for (const evt of feed) {
    const prev = result[result.length - 1];
    const samePropertyId =
      (prev?.property_id ?? null) === (evt.property_id ?? null);
    const sameSearchQuery =
      evt.event_type !== 'search' ||
      prev?.metadata.query === evt.metadata.query;
    const sameShortlistAction =
      evt.event_type !== 'shortlist' ||
      prev?.metadata.action === evt.metadata.action;
    const withinWindow =
      !!prev &&
      Math.abs(
        new Date(prev.created_at).getTime() - new Date(evt.created_at).getTime()
      ) <= DEDUPE_WINDOW_MS;

    if (
      prev &&
      prev.session_key === evt.session_key &&
      prev.event_type === evt.event_type &&
      samePropertyId &&
      sameSearchQuery &&
      sameShortlistAction &&
      withinWindow
    ) {
      prev.repeatCount += 1;
      continue;
    }

    result.push({ ...evt, repeatCount: 1 });
  }

  return result;
}

export function groupEventsByVisitor(
  events: DedupedPulseEvent[]
): VisitorActivityGroup[] {
  const groups = new Map<string, VisitorActivityGroup>();

  for (const event of events) {
    const id = event.contact
      ? `contact:${event.contact.id}`
      : `session:${event.session_key}`;
    const existing = groups.get(id);

    if (existing) {
      existing.events.push(event);
      existing.activityCount += event.repeatCount;
      continue;
    }

    groups.set(id, {
      id,
      latestEvent: event,
      events: [event],
      activityCount: event.repeatCount,
    });
  }

  return Array.from(groups.values());
}

/** "45s dwell" / "2m 10s dwell"; empty when the beacon carried no duration. */
export function formatDwellTime(ms?: number): string {
  if (!ms || Number.isNaN(ms)) return '';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s dwell`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return remSec > 0 ? `${min}m ${remSec}s dwell` : `${min}m dwell`;
}

export function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
}

/** Web parity: src/lib/pulse/feed-page.ts. */
export const PULSE_FEED_PAGE_SIZE = 200;

export const PULSE_VIEWED_LISTINGS_LIMIT = 500;

export const PULSE_LISTINGS_RENDER_STEP = 20;

const LISTINGS_END_THRESHOLD_PX = 200;

export function nextRenderedListingCount(
  rendered: number,
  total: number,
  scroll: { offsetY: number; viewportHeight: number; contentHeight: number }
): number {
  if (rendered >= total) return rendered;
  const nearEnd =
    scroll.offsetY + scroll.viewportHeight >=
    scroll.contentHeight - LISTINGS_END_THRESHOLD_PX;
  return nearEnd
    ? Math.min(total, rendered + PULSE_LISTINGS_RENDER_STEP)
    : rendered;
}

export interface PulseFeedCursor {
  createdAt: string;
  id: string;
}

export function pulseFeedCursorFilter(cursor: PulseFeedCursor): string {
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
}

export function nextPulseFeedCursor(
  rows: readonly { id: string; created_at: string }[],
  pageSize: number = PULSE_FEED_PAGE_SIZE
): PulseFeedCursor | null {
  if (rows.length < pageSize) return null;
  const last = rows[rows.length - 1];
  return { createdAt: last.created_at, id: last.id };
}

/** Web parity: src/lib/pulse/visitor-link.ts. */
export function contactScreenRoute(
  contactId: string
): `/(app)/contact/${string}` {
  return `/(app)/contact/${contactId}`;
}

export function visitorContactRoute(
  event: Pick<PulseEvent, 'contact'>
): `/(app)/contact/${string}` | null {
  return event.contact ? contactScreenRoute(event.contact.id) : null;
}

/** Web parity: activityPropertyHref in src/lib/pulse/visitor-link.ts. */
export function propertyScreenRoute(
  propertyId: string
): `/(app)/property/${string}` {
  return `/(app)/property/${propertyId}`;
}

export function activityPropertyRoute(
  event: Pick<PulseEvent, 'event_type' | 'property'>
): `/(app)/property/${string}` | null {
  if (event.event_type === 'open' || event.event_type === 'search') return null;
  return event.property ? propertyScreenRoute(event.property.id) : null;
}

export interface PulseVisitorLabelParts {
  before: string;
  contact: { id: string; label: string } | null;
  after: string;
}

type LabelEvent = Pick<
  PulseEvent,
  'contact' | 'via_contact' | 'share' | 'session_key'
>;

/**
 * Who a feed row belongs to — web parity with
 * src/lib/pulse/visitor-label.ts. An identified visitor is named; a
 * guest who arrived on a contact's forwarded link is labelled as coming
 * via that contact, never as the contact; a guest from a generic share
 * is dated to the share; everyone else is an anonymous guest. The named
 * contact is returned apart so the feed can render it as a tappable
 * capsule that opens that contact.
 */
export function pulseVisitorLabelParts(
  event: LabelEvent,
  timeAgo: (iso: string) => string
): PulseVisitorLabelParts {
  if (event.contact) {
    return {
      before: '',
      contact: {
        id: event.contact.id,
        label: event.contact.name || event.contact.phone || 'Contact',
      },
      after: '',
    };
  }
  const tail = event.session_key.slice(0, 8);
  if (event.via_contact) {
    return {
      before: 'Guest via ',
      contact: {
        id: event.via_contact.id,
        label: event.via_contact.name || event.via_contact.phone || 'a contact',
      },
      after: `'s link · ${tail}`,
    };
  }
  if (event.share) {
    return {
      before: `Guest · link shared ${timeAgo(event.share.created_at)} · ${tail}`,
      contact: null,
      after: '',
    };
  }
  return { before: `Anonymous guest · ${tail}`, contact: null, after: '' };
}

export function pulseVisitorLabel(
  event: LabelEvent,
  timeAgo: (iso: string) => string
): string {
  const parts = pulseVisitorLabelParts(event, timeAgo);
  return `${parts.before}${parts.contact?.label ?? ''}${parts.after}`;
}
