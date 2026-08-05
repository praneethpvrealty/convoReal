/**
 * A calendar date as 'YYYY-MM-DD', or null for anything else.
 *
 * Day-granularity fields — lease dates, possession — are carried as
 * plain strings end to end. Parsing one through `new Date()` reads it as
 * UTC midnight, which is what shifts a date by a day either side of the
 * meridian; keeping it a string means there is nothing to shift.
 */
export function isoDateOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}
