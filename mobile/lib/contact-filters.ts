/**
 * The Contacts tab's attribute filters — classification, tag, budget
 * band, area of interest and sort order.
 *
 * Ported from the web Contacts page's Filters dialog
 * (src/app/(dashboard)/contacts/contacts-content.tsx), which is the
 * source of truth for the semantics: a min budget admits contacts with
 * no budget set, a max budget does not, and the area column is a text[]
 * matched by containment. Kept in step by src/lib/mobile-parity.test.ts.
 */
import { formatInr } from '@/lib/format';

export type ContactSort =
  | 'created_desc'
  | 'name_asc'
  | 'name_desc'
  | 'last_contacted_desc'
  | 'max_budget_desc'
  | 'max_budget_asc';

export interface ContactFilters {
  classification: string | null;
  tagId: string | null;
  minBudget: number | null;
  maxBudget: number | null;
  area: string | null;
  sort: ContactSort;
}

export const EMPTY_FILTERS: ContactFilters = {
  classification: null,
  tagId: null,
  minBudget: null,
  maxBudget: null,
  area: null,
  sort: 'created_desc',
};

/** The web ladder's values (BUDGET_OPTIONS in
 *  src/lib/contacts/budget-options.ts). Labels are derived rather than
 *  copied — `formatInr` already says "₹5 L" / "₹1.5 Cr", and a chip row
 *  has no room for "1.5 Crores". */
export const BUDGET_STEPS = [
  500000, 1000000, 2000000, 3000000, 4000000, 5000000, 6000000, 8000000,
  10000000, 15000000, 20000000, 30000000, 50000000, 70000000, 100000000,
  150000000, 200000000, 300000000, 500000000, 750000000, 1000000000,
  1500000000, 2000000000,
];

export function budgetStepLabel(value: number): string {
  return formatInr(value);
}

/** The six orders the web Filters drawer offers. */
export const SORT_OPTIONS: { key: ContactSort; label: string }[] = [
  { key: 'created_desc', label: 'Newest' },
  { key: 'name_asc', label: 'Name A–Z' },
  { key: 'name_desc', label: 'Name Z–A' },
  { key: 'last_contacted_desc', label: 'Last contacted' },
  { key: 'max_budget_desc', label: 'Budget high' },
  { key: 'max_budget_asc', label: 'Budget low' },
];

/** Column and direction for a sort key. `created_desc` is the default
 *  the list has always used. */
export function sortColumn(sort: ContactSort): {
  column: string;
  ascending: boolean;
} {
  switch (sort) {
    case 'name_asc':
      return { column: 'name', ascending: true };
    case 'name_desc':
      return { column: 'name', ascending: false };
    case 'last_contacted_desc':
      return { column: 'last_contacted_at', ascending: false };
    case 'max_budget_desc':
      return { column: 'max_budget', ascending: false };
    case 'max_budget_asc':
      return { column: 'max_budget', ascending: true };
    default:
      return { column: 'created_at', ascending: false };
  }
}

/** How many narrowing filters are on. Sort is an ordering, not a
 *  narrowing, so it stays out of the badge — same as the web chip. */
export function activeFilterCount(filters: ContactFilters): number {
  return [
    filters.classification,
    filters.tagId,
    filters.minBudget,
    filters.maxBudget,
    filters.area,
  ].filter((v) => v !== null).length;
}

/** True once anything at all differs from the defaults, sort included —
 *  what "Clear all" acts on. */
export function isDirty(filters: ContactFilters): boolean {
  return activeFilterCount(filters) > 0 || filters.sort !== 'created_desc';
}

/** Stable identity for the react-query key. */
export function filtersKey(filters: ContactFilters): string {
  return [
    filters.classification ?? '',
    filters.tagId ?? '',
    filters.minBudget ?? '',
    filters.maxBudget ?? '',
    filters.area ?? '',
    filters.sort,
  ].join('|');
}
