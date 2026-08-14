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
  // 276 is the collision this guard cannot prevent on its own: #540
  // (listing submission documents) and #539 (reminder audio) both took
  // it, each went green while the other was still open, and the pair
  // only met on main. A merge queue would have caught it, but GitHub's
  // needs an organization-owned repository and this one is user-owned,
  // so the trigger is inert (see AGENTS.md §12). Frozen rather than
  // renumbered because both are already merged, and the two touch
  // different tables — nothing depends on their order.
  "276",
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
