/**
 * The Contacts area filter's grouped options and the PostgREST clause a
 * selection becomes. GET /api/contacts/area-options does the spelling
 * grouping on the server (src/lib/contacts/area-variants.ts owns the
 * key); this mirrors only the two builders both surfaces apply to the
 * list query. Kept in step by src/lib/mobile-parity.test.ts.
 */

export interface AreaOption {
  key: string;
  label: string;
  variants: string[];
  count: number;
}

export const AREA_OPTIONS_QUERY_KEY = ['contact-area-options'];

export const AREA_FILTER_COLUMNS = ['areas_of_interest', 'pref_areas'];

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
  const wanted = new Set(keys);
  return Array.from(
    new Set(
      options
        .filter((option) => wanted.has(option.key))
        .flatMap((option) => option.variants)
    )
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
