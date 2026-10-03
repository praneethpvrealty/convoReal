/**
 * The Showcase Pulse viewed-listings sort and row shape (PLS-005),
 * shared at runtime by web and mobile. The mobile app bundles this file
 * through `@shared/`, so it must stay free of imports.
 */

export type PulseListingSort =
  'views_desc' | 'views_asc' | 'recent_desc' | 'recent_asc';

export const DEFAULT_PULSE_LISTING_SORT: PulseListingSort = 'views_desc';

export const PULSE_LISTING_SORTS: ReadonlyArray<{
  key: PulseListingSort;
  label: string;
}> = [
  { key: 'views_desc', label: 'Most views' },
  { key: 'views_asc', label: 'Fewest views' },
  { key: 'recent_desc', label: 'Latest viewed' },
  { key: 'recent_asc', label: 'Earliest viewed' },
];

export interface PulseViewedListing {
  propertyId: string;
  title: string;
  propertyCode: string | null;
  price: number | null;
  viewsCount: number;
  uniqueViewsCount: number;
  lastViewedAt: string;
}

export interface PulseViewedListingRow {
  property_id: string;
  title: string;
  property_code: string | null;
  price: number | null;
  views_count: number;
  unique_views_count: number;
  last_viewed_at: string;
}

export function toPulseViewedListing(
  row: PulseViewedListingRow
): PulseViewedListing {
  return {
    propertyId: row.property_id,
    title: row.title,
    propertyCode: row.property_code,
    price: row.price,
    viewsCount: Number(row.views_count),
    uniqueViewsCount: Number(row.unique_views_count),
    lastViewedAt: row.last_viewed_at,
  };
}
