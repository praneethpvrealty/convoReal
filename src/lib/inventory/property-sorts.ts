export type PropertySortField =
  'created_at' | 'updated_at' | 'price' | 'title' | 'location' | 'status';

export type PropertySortOrder = 'asc' | 'desc';

export interface PropertySort {
  key: string;
  label: string;
  field: PropertySortField;
  order: PropertySortOrder;
}

export const PROPERTY_SORTS: readonly PropertySort[] = [
  {
    key: 'newest',
    label: 'Recently added',
    field: 'created_at',
    order: 'desc',
  },
  {
    key: 'updated',
    label: 'Recently modified',
    field: 'updated_at',
    order: 'desc',
  },
  {
    key: 'price_desc',
    label: 'Price: high to low',
    field: 'price',
    order: 'desc',
  },
  {
    key: 'price_asc',
    label: 'Price: low to high',
    field: 'price',
    order: 'asc',
  },
  { key: 'title_asc', label: 'Title A–Z', field: 'title', order: 'asc' },
];

export const DEFAULT_PROPERTY_SORT = PROPERTY_SORTS[0];

export function propertySortByKey(
  key: string | null | undefined
): PropertySort {
  return PROPERTY_SORTS.find((s) => s.key === key) ?? DEFAULT_PROPERTY_SORT;
}

const FIELD_LABELS: Record<PropertySortField, string> = {
  created_at: 'Added',
  updated_at: 'Modified',
  price: 'Price',
  title: 'Title',
  location: 'Locality',
  status: 'Status',
};

function orderLabel(field: PropertySortField, order: PropertySortOrder) {
  if (field === 'created_at' || field === 'updated_at')
    return order === 'desc' ? 'newest first' : 'oldest first';
  if (field === 'price')
    return order === 'desc' ? 'high to low' : 'low to high';
  return order === 'asc' ? 'A–Z' : 'Z–A';
}

export function propertySortFor(
  field: PropertySortField,
  order: PropertySortOrder
): PropertySort {
  return (
    PROPERTY_SORTS.find((s) => s.field === field && s.order === order) ?? {
      key: `${field}_${order}`,
      label: `${FIELD_LABELS[field]}: ${orderLabel(field, order)}`,
      field,
      order,
    }
  );
}

/** A column header click: same column flips the direction, a new
 *  column starts on the direction that reads naturally for it. */
export function nextColumnSort(
  current: PropertySort,
  field: PropertySortField
): PropertySort {
  if (current.field === field) {
    return propertySortFor(field, current.order === 'asc' ? 'desc' : 'asc');
  }
  const naturalOrder: PropertySortOrder =
    field === 'title' || field === 'location' || field === 'status'
      ? 'asc'
      : 'desc';
  return propertySortFor(field, naturalOrder);
}
