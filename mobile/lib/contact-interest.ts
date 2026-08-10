/**
 * The Contacts tab's "Enquired for" filter — narrow the list to the
 * people who showed interest in one property, or in anything inside one
 * project.
 *
 * Web (contacts-content.tsx) does the property half of this with up to
 * six chips fed from Inventory stars. Mobile keeps those as quick picks
 * but lets any listing be chosen by search, and adds the project axis:
 * a tower's buyers are spread across its units, so a per-unit chip finds
 * a fraction of them.
 *
 * `value` is a property id for `property` and a project NAME for
 * `project` — properties.project (TEXT) stays authoritative for units
 * that predate the projects table (migration 227), so matching on the
 * name catches linked and unlinked units alike.
 */
export type InterestFilter = {
  kind: 'property' | 'project';
  value: string;
  label: string;
};

/** Chip text for the active filter. Property codes are short; project
 *  names are not, and the chip sits in a scrolling row beside five
 *  segment pills. */
export function interestChipLabel(
  filter: InterestFilter,
  max = 18
): string {
  const label = filter.label.trim();
  return label.length > max ? `${label.slice(0, max - 1).trimEnd()}…` : label;
}

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
