import type { HydratedShowcaseEvent } from './queries';

/** A merged run of consecutive, near-identical events collapses into one
 *  entry with a repeat count instead of N separate timeline rows. */
export interface DedupedShowcaseEvent extends HydratedShowcaseEvent {
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
 * newest-first (as loadPulseFeed returns it) — the first event in a run
 * is the most recent, so its timestamp is what the merged row keeps.
 */
export function dedupeConsecutiveEvents(
  feed: HydratedShowcaseEvent[]
): DedupedShowcaseEvent[] {
  const result: DedupedShowcaseEvent[] = [];

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
