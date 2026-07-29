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
}

/** A merged run of consecutive, near-identical events. */
export interface DedupedPulseEvent extends PulseEvent {
  repeatCount: number;
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
export function dedupeConsecutiveEvents(feed: PulseEvent[]): DedupedPulseEvent[] {
  const result: DedupedPulseEvent[] = [];

  for (const evt of feed) {
    const prev = result[result.length - 1];
    const samePropertyId = (prev?.property_id ?? null) === (evt.property_id ?? null);
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
      withinWindow
    ) {
      prev.repeatCount += 1;
      continue;
    }

    result.push({ ...evt, repeatCount: 1 });
  }

  return result;
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
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
