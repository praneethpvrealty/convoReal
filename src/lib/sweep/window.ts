// ============================================================
// Which day the sweep is reading.
//
// "Last one day's data" at 6am means the twenty-four hours that just
// ended, not yesterday's calendar page. The difference is the whole
// evening: a brokerage does most of its WhatsApp between 6pm and
// 11pm, and a calendar-day window run at 6am would either report
// that evening a day and a half late or, if it ran on the previous
// date, skip everything after midnight. Trailing 24h ending at the
// IST 06:00 boundary is the window that matches how the day is
// actually worked.
//
// Everything here is arithmetic on a passed-in Date. No clock is
// read, so the scheduling is provable without one.
// ============================================================

/** IST is UTC+05:30 and has no DST — a fixed offset is exact here,
 *  which is why this does not reach for a timezone database. */
export const IST_OFFSET_MINUTES = 330;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** The IST calendar date of an instant, as 'YYYY-MM-DD'. */
export function istDateKey(at: Date): string {
  const shifted = new Date(at.getTime() + IST_OFFSET_MINUTES * MINUTE_MS);
  return shifted.toISOString().slice(0, 10);
}

/** Minutes past IST midnight. */
export function istMinutesOfDay(at: Date): number {
  const shifted = new Date(at.getTime() + IST_OFFSET_MINUTES * MINUTE_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

export interface SweepWindow {
  start: Date;
  end: Date;
  /** The IST date the window ENDS on. This is the ledger's claim key,
   *  so a run that slips to 06:40 still claims the same morning and a
   *  retry is a no-op. */
  runDate: string;
}

/**
 * The most recent 06:00 IST boundary at or before `now`, and the
 * twenty-four hours leading up to it.
 *
 * Anchoring the window to the boundary rather than to `now` is what
 * makes the run idempotent in a way the ledger alone would not be: a
 * cron that fires at 06:02 and a manual rerun at 06:41 read exactly
 * the same messages, so the second one cannot raise a gap the first
 * one missed only because time moved.
 */
export function sweepWindow(now: Date, boundaryHourIst = 6): SweepWindow {
  const minutesNow = istMinutesOfDay(now);
  const boundaryMinutes = boundaryHourIst * 60;

  // Midnight IST of the day `now` falls in, expressed as a UTC instant.
  const istMidnight = new Date(
    now.getTime() - minutesNow * MINUTE_MS - (now.getTime() % MINUTE_MS)
  );

  let end = new Date(istMidnight.getTime() + boundaryMinutes * MINUTE_MS);
  // Before this morning's boundary, the last completed one is yesterday's.
  if (minutesNow < boundaryMinutes)
    end = new Date(end.getTime() - 24 * HOUR_MS);

  const start = new Date(end.getTime() - 24 * HOUR_MS);
  return { start, end, runDate: istDateKey(end) };
}

/**
 * Has this instant's boundary already passed today?
 *
 * The cron is registered more often than once a day so a run lost to
 * a platform outage catches up on the next tick instead of losing the
 * morning — the same reason agent-task-digest is scheduled every half
 * hour for three fixed times. The ledger stops the catch-up from
 * sending twice; this only stops it from starting early.
 */
export function boundaryHasPassed(now: Date, boundaryHourIst = 6): boolean {
  return istMinutesOfDay(now) >= boundaryHourIst * 60;
}
