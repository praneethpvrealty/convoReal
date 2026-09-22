export type ContactSortKey =
  | 'created_desc'
  | 'updated_desc'
  | 'name_asc'
  | 'name_desc'
  | 'last_contacted_desc'
  | 'last_contacted_asc'
  | 'max_budget_desc'
  | 'max_budget_asc';

export interface ContactSortItem {
  value: ContactSortKey;
  label: string;
}

export const CONTACT_SORTS: readonly ContactSortItem[] = [
  { value: 'created_desc', label: 'Newest' },
  { value: 'updated_desc', label: 'Recently modified' },
  { value: 'name_asc', label: 'Name A–Z' },
  { value: 'name_desc', label: 'Name Z–A' },
  { value: 'last_contacted_desc', label: 'Last contacted' },
  { value: 'max_budget_desc', label: 'Budget high' },
  { value: 'max_budget_asc', label: 'Budget low' },
];

export const DEFAULT_CONTACT_SORT: ContactSortKey = 'created_desc';

const COLUMN_ONLY_LABELS: Partial<Record<ContactSortKey, string>> = {
  last_contacted_asc: 'Least recently contacted',
};

export function contactSortLabel(key: string): string {
  return (
    CONTACT_SORTS.find((s) => s.value === key)?.label ??
    COLUMN_ONLY_LABELS[key as ContactSortKey] ??
    CONTACT_SORTS[0].label
  );
}

export function contactSortItems(current: string): ContactSortItem[] {
  if (CONTACT_SORTS.some((s) => s.value === current)) return [...CONTACT_SORTS];
  const label = COLUMN_ONLY_LABELS[current as ContactSortKey];
  return label
    ? [...CONTACT_SORTS, { value: current as ContactSortKey, label }]
    : [...CONTACT_SORTS];
}

export interface ContactListFilters {
  classification: string;
  tag: string;
  minBudget: string;
  maxBudget: string;
  areas: string[];
  interestProperty: string;
  interestProject: string;
}

export function activeContactFilterCount(filters: ContactListFilters): number {
  return Object.values(filters).filter((v) =>
    Array.isArray(v) ? v.length > 0 : v !== 'All'
  ).length;
}

export function contactListCacheKey(
  accountId: string,
  page: number,
  tab: string,
  sort: string,
  filters: ContactListFilters,
  search: string
): string {
  return [
    'contacts',
    accountId,
    page,
    tab,
    sort,
    filters.classification,
    filters.tag,
    filters.minBudget,
    filters.maxBudget,
    filters.areas.join('+'),
    filters.interestProperty,
    filters.interestProject,
    search,
  ].join('-');
}
