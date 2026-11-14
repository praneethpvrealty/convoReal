/**
 * Whether another query's cached copy is recent enough to open an
 * editable form from. A seed this old is no different from having opened
 * the form that long ago; anything older waits for its own fetch so a
 * draft never starts from values someone else has since changed.
 */
export const EDIT_SEED_MAX_AGE_MS = 2 * 60 * 1000;

export function isFreshSeed(
  dataUpdatedAt: number | undefined,
  now: number,
  maxAgeMs = EDIT_SEED_MAX_AGE_MS
): boolean {
  return (
    typeof dataUpdatedAt === 'number' &&
    dataUpdatedAt > 0 &&
    now - dataUpdatedAt <= maxAgeMs
  );
}
