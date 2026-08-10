/**
 * The Properties tab's attribute filters — type, status, source,
 * showcase state, asking-price band and sort order.
 *
 * Unlike Contacts, this list is served by the web's
 * `GET /api/properties`, so every filter here is a query param that
 * route already understands (`src/app/api/properties/route.ts`). None
 * of this widens the API surface.
 */
import { BUDGET_STEPS, budgetStepLabel } from '@/lib/money-ladder';

export { BUDGET_STEPS, budgetStepLabel };

export type PropertySort =
  | 'newest'
  | 'updated'
  | 'price_desc'
  | 'price_asc'
  | 'title_asc';

export interface PropertyFilters {
  /** A category key the route expands over its subtypes
   *  (`CATEGORY_SUBTYPES` in src/lib/search-parser.ts), or one exact
   *  `properties.type` value. */
  type: string | null;
  status: string | null;
  source: 'owner' | 'agent' | null;
  /** `is_published` — showcased on the public portal or not. */
  showcase: 'true' | 'false' | null;
  minPrice: number | null;
  maxPrice: number | null;
  sort: PropertySort;
}

export const EMPTY_PROPERTY_FILTERS: PropertyFilters = {
  type: null,
  status: null,
  source: null,
  showcase: null,
  minPrice: null,
  maxPrice: null,
  sort: 'newest',
};

/** The categories the route expands; sending one of these matches every
 *  subtype under it. */
export const TYPE_CATEGORIES = ['Residential', 'Commercial', 'Agricultural'];

/** The status vocabulary the web inventory badges (property-list.tsx).
 *  Archived is deliberately absent — nothing on mobile asks for it. */
export const PROPERTY_STATUSES = [
  'Available',
  'Under Contract',
  'Sold',
  'Off Market',
  'Pending Review',
  'Rejected',
];

/** Sort keys mapped onto the route's `sort` + `order` pair. Only fields
 *  in its ALLOWED_SORT_FIELDS list are offered. */
export const PROPERTY_SORTS: {
  key: PropertySort;
  label: string;
  field: string;
  order: 'asc' | 'desc';
}[] = [
  { key: 'newest', label: 'Newest', field: 'created_at', order: 'desc' },
  {
    key: 'updated',
    label: 'Recently updated',
    field: 'updated_at',
    order: 'desc',
  },
  { key: 'price_desc', label: 'Price high', field: 'price', order: 'desc' },
  { key: 'price_asc', label: 'Price low', field: 'price', order: 'asc' },
  { key: 'title_asc', label: 'Title A–Z', field: 'title', order: 'asc' },
];

/** How many narrowing filters are on. Sort orders rather than narrows,
 *  so it stays out of the badge — same rule as the Contacts chip. */
export function activePropertyFilterCount(filters: PropertyFilters): number {
  return [
    filters.type,
    filters.status,
    filters.source,
    filters.showcase,
    filters.minPrice,
    filters.maxPrice,
  ].filter((v) => v !== null).length;
}

/** True once anything differs from the defaults, sort included — what
 *  "Clear all" acts on. */
export function isPropertyFiltersDirty(filters: PropertyFilters): boolean {
  return (
    activePropertyFilterCount(filters) > 0 || filters.sort !== 'newest'
  );
}

/** Stable identity for the react-query key. */
export function propertyFiltersKey(filters: PropertyFilters): string {
  return [
    filters.type ?? '',
    filters.status ?? '',
    filters.source ?? '',
    filters.showcase ?? '',
    filters.minPrice ?? '',
    filters.maxPrice ?? '',
    filters.sort,
  ].join('|');
}

/**
 * The route rejects `status` and `exclude_archived` together, so exactly
 * one is ever sent. An explicit status from the sheet wins over the
 * coarse "Include unavailable" chip; with no status chosen the chip's
 * long-standing behaviour is unchanged — Available only, or everything
 * bar Archived.
 */
export function statusParam(
  filters: PropertyFilters,
  includeUnavailable: boolean
): [name: string, value: string] {
  if (filters.status) return ['status', filters.status];
  if (includeUnavailable) return ['exclude_archived', 'true'];
  return ['status', 'Available'];
}

/**
 * Write the non-status filters onto an outgoing query string.
 *
 * `hasNear` suppresses the sort: with a location anchor the route runs
 * its tiered path, which orders by match tier then distance and ignores
 * `sort` entirely. Sending one anyway would be a promise the server
 * does not keep.
 */
export function applyPropertyFilterParams(
  params: URLSearchParams,
  filters: PropertyFilters,
  hasNear: boolean
): URLSearchParams {
  if (filters.type) params.set('type', filters.type);
  if (filters.source) params.set('listing_source', filters.source);
  if (filters.showcase) params.set('is_published', filters.showcase);
  if (filters.minPrice !== null)
    params.set('min_price', String(filters.minPrice));
  if (filters.maxPrice !== null)
    params.set('max_price', String(filters.maxPrice));

  if (!hasNear && filters.sort !== 'newest') {
    const sort = PROPERTY_SORTS.find((s) => s.key === filters.sort);
    if (sort) {
      params.set('sort', sort.field);
      params.set('order', sort.order);
    }
  }
  return params;
}
