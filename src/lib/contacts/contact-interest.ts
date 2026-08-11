/**
 * The Contacts page's "Enquired for" project axis — a tower's buyers
 * are spread across its units, so filtering by any one unit finds a
 * fraction of them; the project name finds them all.
 *
 * Project names come off inventory rows rather than the projects
 * table: properties.project (TEXT) stays authoritative for units that
 * predate the projects table (migration 227), so the string is the
 * only field that sees the whole tower.
 *
 * The mobile app carries a port of this in mobile/lib/contact-interest.ts,
 * kept in step by src/lib/mobile-parity.test.ts.
 */

/**
 * Distinct projects across a bounded page of inventory rows, with how
 * many units of each this account holds. Deduped case-insensitively —
 * "Prestige Lakeside" and "prestige lakeside" are one tower typed twice
 * — keeping the first spelling seen. Ordered by unit count so the
 * projects worth filtering by are at the top.
 */
export function projectOptions(
  rows: { project?: string | null }[],
  search = ''
): { name: string; count: number }[] {
  const term = search.trim().toLowerCase();
  const byKey = new Map<string, { name: string; count: number }>();
  for (const row of rows) {
    const name = row.project?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const existing = byKey.get(key);
    if (existing) existing.count += 1;
    else byKey.set(key, { name, count: 1 });
  }
  return Array.from(byKey.values())
    .filter((p) => !term || p.name.toLowerCase().includes(term))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
