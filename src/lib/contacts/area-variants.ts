/**
 * Groups the localities stored on contacts by spelling, so the Contacts
 * area filter offers "Brookefield" once instead of once per spelling
 * ("Brookfield", "brookefield", "Brookefield, Bengaluru") and a pick
 * matches every one of them. Web and mobile both read the grouped list
 * from GET /api/contacts/area-options, so the key lives here alone;
 * mobile/lib/contact-area-options.ts mirrors only the filter builders.
 */

export interface AreaOption {
  key: string;
  label: string;
  variants: string[];
  count: number;
}

export const AREA_FILTER_COLUMNS = ['areas_of_interest', 'pref_areas'];

/** Groups an agent can have on at once. The spellings of every selected
 *  group travel in the list request's URL, once per column, so the
 *  selection is bounded rather than open-ended (AGENTS.md §2.6). */
export const MAX_SELECTED_AREAS = 12;
/** Hard ceiling on the spellings one list request may carry. */
export const MAX_AREA_FILTER_VARIANTS = 60;

const TRAILING_CITY =
  /(?:[\s,]+(?:bengaluru|bangalore|bengalooru|blr|karnataka|india))+\s*$/;

export function areaVariantKey(area: string): string {
  const base = area
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .trim();
  const collapsed = (base.replace(TRAILING_CITY, '').trim() || base)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => (word.length > 4 ? word.replace(/([^s])s$/, '$1') : word))
    .map((word) => word.replace(/(.)\1+/g, '$1'))
    .join('');
  if (!collapsed) return base;
  let key = collapsed[0];
  let vowelKept = false;
  for (const ch of collapsed.slice(1)) {
    if ('aeiou'.includes(ch)) {
      if (!vowelKept) {
        key += ch;
        vowelKept = true;
      }
      continue;
    }
    if (ch !== 'h') key += ch;
  }
  return key;
}

const lowercaseOnly = (value: string) =>
  value === value.toLowerCase() ? 1 : 0;

export function groupAreaVariants(
  rows: { area: string; count: number }[]
): AreaOption[] {
  const groups = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const area = row.area.trim();
    if (!area) continue;
    const key = areaVariantKey(area);
    const variants = groups.get(key) ?? new Map<string, number>();
    variants.set(area, (variants.get(area) ?? 0) + Math.max(0, row.count));
    groups.set(key, variants);
  }
  return Array.from(groups, ([key, variants]) => {
    const ranked = Array.from(variants).sort(
      (a, b) =>
        b[1] - a[1] ||
        lowercaseOnly(a[0]) - lowercaseOnly(b[0]) ||
        a[0].localeCompare(b[0])
    );
    return {
      key,
      label: ranked[0][0],
      variants: ranked.map(([variant]) => variant),
      count: ranked.reduce((total, [, count]) => total + count, 0),
    };
  }).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  );
}

export function areaOptionLabel(option: AreaOption): string {
  const spellings = option.variants.length;
  return spellings > 1
    ? `${option.label} (${spellings} spellings)`
    : option.label;
}

export function areaFilterVariants(
  keys: string[],
  options: AreaOption[]
): string[] {
  const wanted = new Set(keys.slice(0, MAX_SELECTED_AREAS));
  return Array.from(
    new Set(
      options
        .filter((option) => wanted.has(option.key))
        .flatMap((option) => option.variants)
    )
  ).slice(0, MAX_AREA_FILTER_VARIANTS);
}

/** The stored spellings a typed locality stands for: every spelling in
 *  the group the term keys to, or nothing when no contact carries it —
 *  the caller then keeps its plain text match. */
export function areaSearchVariants(
  term: string,
  options: AreaOption[]
): string[] {
  const key = areaVariantKey(term);
  if (!key) return [];
  return areaFilterVariants(
    options.filter((option) => option.key === key).map((option) => option.key),
    options
  );
}

export function areaOverlapFilter(
  columns: string[],
  variants: string[]
): string {
  const list = variants
    .map((variant) => variant.replace(/[{}]/g, '').trim())
    .filter(Boolean)
    .map(
      (variant) => `"${variant.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    )
    .join(',');
  return columns.map((column) => `${column}.ov.{${list}}`).join(',');
}
