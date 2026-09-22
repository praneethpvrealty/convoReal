/**
 * The Contacts area filter's grouped options, the PostgREST clause a
 * selection becomes, and the spelling key that maps a typed locality
 * onto its group for the search box. GET /api/contacts/area-options
 * does the grouping on the server; this mirrors the key and builders
 * from src/lib/contacts/area-variants.ts, which is the source of
 * truth. Kept in step by src/lib/mobile-parity.test.ts.
 */

export interface AreaOption {
  key: string;
  label: string;
  variants: string[];
  count: number;
}

export const AREA_OPTIONS_QUERY_KEY = ['contact-area-options'];

export const AREA_FILTER_COLUMNS = ['areas_of_interest', 'pref_areas'];

/** Groups an agent can have on at once — the spellings travel in the
 *  list request's URL, once per column, so the selection is bounded. */
export const MAX_SELECTED_AREAS = 12;
/** Hard ceiling on the spellings one list request may carry. */
export const MAX_AREA_FILTER_VARIANTS = 60;

const TRAILING_CITY =
  /(?:[\s,]+(?:bengaluru|bangalore|bengalooru|blr|karnataka|india))+\s*$/;

export function areaVariantKey(area: string): string {
  const base = area
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
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

/** "buyers in Brookfield", "at AECS Layout", "near Whitefield for 2 cr":
 *  the locality phrases a search names, the same way the web query
 *  parser reads them. The whole text is a candidate too, for a bare
 *  locality. */
const LOCALITY_PHRASE =
  /\b(?:in|at|near|around|from)\s+([a-z0-9][a-z0-9\s]{2,40}?)(?=\s+(?:with|for|under|above|below|price|area|bhk)|[,.]|$)/gi;

export function areaSearchTerms(query: string): string[] {
  const text = query.trim();
  if (!text) return [];
  const terms = [text];
  for (const match of text.matchAll(LOCALITY_PHRASE)) {
    const phrase = match[1].trim().replace(/\s+/g, ' ');
    if (phrase.length >= 3) terms.push(phrase);
  }
  return Array.from(new Set(terms));
}

/** The stored spellings a search stands for: every spelling in each
 *  group the text, or a locality phrase in it, keys to — or nothing
 *  when no contact carries one, so the caller keeps its plain text
 *  match. */
export function areaSearchVariants(
  query: string,
  options: AreaOption[]
): string[] {
  const keys = new Set(
    areaSearchTerms(query)
      .map((term) => areaVariantKey(term))
      .filter(Boolean)
  );
  return areaFilterVariants(
    options
      .filter((option) => keys.has(option.key))
      .map((option) => option.key),
    options
  );
}

export function areasMatchSearch(query: string, areas: string[]): boolean {
  const keys = new Set(
    areaSearchTerms(query)
      .map((term) => areaVariantKey(term))
      .filter(Boolean)
  );
  if (keys.size === 0) return false;
  return areas.some((area) => keys.has(areaVariantKey(area)));
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
