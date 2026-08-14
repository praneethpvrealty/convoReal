/**
 * Migration filenames lead with a version that orders them.
 *
 * The old scheme was a sequence — 001, 002, … — and it had one failure
 * mode that nothing in CI could catch. Two branches open at the same
 * time both take the next free number, git raises no conflict because
 * the filenames differ, and each PR goes green while the other is still
 * open. The collision only exists once both are on main. It happened
 * twice on 2026-08-14 alone (276 between #539 and #540, then 277
 * between #542 and #541), and twenty prefixes in the back catalogue are
 * doubled up the same way. A merge queue would serialise it, but
 * GitHub's needs an organization-owned repository and this one is
 * user-owned, so the merge_group trigger is inert (AGENTS.md §12).
 *
 * So new migrations carry a UTC timestamp instead: `YYYYMMDDHHMMSS_
 * description.sql`, the same shape the Supabase CLI generates. Two
 * branches cannot pick the same one, because neither is picking — the
 * clock is.
 *
 * The 298 files already merged KEEP their sequential names. Renaming a
 * migration that self-hosters have applied would show up on their next
 * pull as a file they have never run. `LEGACY_SEQUENCE_CEILING` is the
 * boundary: at or below it, a sequential name is history; above it, a
 * sequential name is someone reaching for the old scheme, and
 * `findLateSequentialMigrations` fails the build.
 *
 * ORDER. Migrations are applied by hand, one named file at a time, in
 * the Supabase SQL Editor — there is no runner sorting this directory,
 * so nothing breaks on the day the two schemes meet. Be aware that a
 * plain `ls` sorts a timestamp BETWEEN 199 and 200 ('2' then '0' beats
 * '2' then '7'), which is a quirk of string sorting, not the real
 * order. `migrationsInApplyOrder` is the real order, and
 * `npm run migration:list` prints it.
 */

/** The highest number the sequential scheme ever issued. Anything above
 *  it must be a timestamp. Raise this only to record history, never to
 *  make room for a new sequential migration. */
export const LEGACY_SEQUENCE_CEILING = 278;

/**
 * Prefixes doubled up under the old scheme. Frozen so the duplicate
 * test can fail on new collisions without demanding a renumber of
 * everything already merged.
 *
 * This list is closed. The timestamp scheme is what stops it growing —
 * an entry added here would mean a sequential migration got merged
 * after the cutover, which `findLateSequentialMigrations` rejects
 * first.
 */
export const KNOWN_DUPLICATE_PREFIXES: ReadonlySet<string> = new Set([
  "063", "073", "078", "092", "103", "110", "115", "126", "151", "154",
  "166", "173", "175", "179", "194", "195", "198", "200", "203", "204",
]);

export type MigrationScheme = "legacy" | "timestamp";

export interface MigrationVersion {
  /** The prefix exactly as written, so 063 and 63 stay distinct. */
  prefix: string;
  scheme: MigrationScheme;
}

export function migrationPrefix(filename: string): string | null {
  const match = filename.match(/^(\d+)_.*\.sql$/);
  return match ? match[1] : null;
}

/**
 * A 14-digit UTC stamp that is a real calendar instant. The digits are
 * re-derived from the parsed date rather than range-checked field by
 * field, so 20260231000000 (February 31st) is rejected rather than
 * rolling forward into March.
 */
export function isTimestampPrefix(prefix: string): boolean {
  if (!/^\d{14}$/.test(prefix)) return false;
  const [year, month, day, hour, minute, second] = [
    prefix.slice(0, 4),
    prefix.slice(4, 6),
    prefix.slice(6, 8),
    prefix.slice(8, 10),
    prefix.slice(10, 12),
    prefix.slice(12, 14),
  ].map(Number);
  // Before the cutover there were no timestamps, so a stamp older than
  // the sequential era is a typo, not history.
  if (year < 2026 || year > 2999) return false;
  const date = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second)
  );
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
}

/** The version a filename carries, or null when it is not a migration. */
export function migrationVersion(filename: string): MigrationVersion | null {
  const prefix = migrationPrefix(filename);
  if (!prefix) return null;
  if (isTimestampPrefix(prefix)) return { prefix, scheme: "timestamp" };
  return { prefix, scheme: "legacy" };
}

/** Prefix → the filenames sharing it, for prefixes used more than once. */
export function findDuplicatePrefixes(filenames: string[]): Map<string, string[]> {
  const byPrefix = new Map<string, string[]>();
  for (const name of filenames) {
    const prefix = migrationPrefix(name);
    if (!prefix) continue;
    const existing = byPrefix.get(prefix);
    if (existing) existing.push(name);
    else byPrefix.set(prefix, [name]);
  }
  const duplicates = new Map<string, string[]>();
  for (const [prefix, names] of byPrefix) {
    if (names.length > 1) duplicates.set(prefix, names.sort());
  }
  return duplicates;
}

/** Duplicates that are not part of the frozen history — i.e. new ones. */
export function findNewDuplicatePrefixes(filenames: string[]): Map<string, string[]> {
  const fresh = new Map<string, string[]>();
  for (const [prefix, names] of findDuplicatePrefixes(filenames)) {
    if (!KNOWN_DUPLICATE_PREFIXES.has(prefix)) fresh.set(prefix, names);
  }
  return fresh;
}

/**
 * Sequential migrations added after the cutover — the mistake this
 * scheme exists to prevent. A number above the ceiling is someone
 * reading the directory, adding one, and re-opening the race.
 */
export function findLateSequentialMigrations(filenames: string[]): string[] {
  return filenames
    .filter((name) => {
      const version = migrationVersion(name);
      if (!version || version.scheme !== "legacy") return false;
      return Number(version.prefix) > LEGACY_SEQUENCE_CEILING;
    })
    .sort();
}

/**
 * Version order: the sequential era first, oldest to newest, then the
 * timestamped era. Not the same as sorting the filenames — see the
 * header's note on `ls`.
 *
 * Returns 0 for two files sharing a version, which the frozen
 * duplicates do; callers wanting a total order tie-break themselves.
 */
export function compareMigrationVersions(
  left: MigrationVersion,
  right: MigrationVersion
): number {
  if (left.scheme !== right.scheme) return left.scheme === "legacy" ? -1 : 1;
  // Legacy prefixes are short enough to compare as numbers; timestamps
  // are equal-width, so string order is already chronological.
  return left.scheme === "legacy"
    ? Number(left.prefix) - Number(right.prefix)
    : left.prefix.localeCompare(right.prefix);
}

/** Apply order for two filenames, falling back to the name itself so a
 *  shared version still sorts deterministically. */
export function compareMigrations(a: string, b: string): number {
  const left = migrationVersion(a);
  const right = migrationVersion(b);
  if (!left || !right) return a.localeCompare(b);
  const byVersion = compareMigrationVersions(left, right);
  return byVersion !== 0 ? byVersion : a.localeCompare(b);
}

/** Every migration in the directory, in the order they should be run. */
export function migrationsInApplyOrder(filenames: string[]): string[] {
  return filenames.filter(migrationVersion).sort(compareMigrations);
}
