/**
 * Migration filenames lead with a number that orders them. Two branches
 * open at the same time both take the next free one, and git raises no
 * conflict because the filenames differ — so the collision lands
 * silently and the pair has no defined order. Twenty prefixes in
 * supabase/migrations are already doubled up this way.
 *
 * `KNOWN_DUPLICATE_PREFIXES` freezes that history so the test alongside
 * this file can fail on new collisions without first demanding a
 * renumber of everything already merged.
 */
export const KNOWN_DUPLICATE_PREFIXES: ReadonlySet<string> = new Set([
  "063", "073", "078", "092", "103", "110", "115", "126", "151", "154",
  "166", "173", "175", "179", "194", "195", "198", "200", "203", "204",
]);

export function migrationPrefix(filename: string): string | null {
  const match = filename.match(/^(\d+)_.*\.sql$/);
  return match ? match[1] : null;
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
 * Sequential prefixes through 289 are frozen legacy history. New migrations
 * must use the 14-digit UTC timestamp produced by `supabase migration new`.
 */
export const LEGACY_SEQUENCE_CEILING = 289;

export function findPostLegacySequentialMigrations(
  filenames: string[]
): string[] {
  return filenames
    .filter((filename) => {
      const prefix = migrationPrefix(filename);
      if (!prefix || !/^\d{1,3}$/.test(prefix)) return false;
      return Number(prefix) > LEGACY_SEQUENCE_CEILING;
    })
    .sort();
}
