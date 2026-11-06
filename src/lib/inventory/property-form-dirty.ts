import {
  buildPropertyPayload,
  type PropertyFormValues,
} from '@/lib/inventory/property-form-state';

function comparablePayload(values: PropertyFormValues, isEdit: boolean) {
  const payload: Record<string, unknown> = {
    ...buildPropertyPayload(values, { isEdit }),
  };
  delete payload.updated_at;
  const interested = payload.interested_contact_ids;
  payload.interested_contact_ids = Array.isArray(interested)
    ? [...interested].sort()
    : interested;
  return JSON.stringify(payload);
}

export function propertyFormIsDirty(
  baseline: PropertyFormValues | null,
  current: PropertyFormValues,
  isEdit: boolean
): boolean {
  if (!baseline) return false;
  return (
    comparablePayload(baseline, isEdit) !== comparablePayload(current, isEdit)
  );
}

const ERROR_FIELDS: ReadonlyArray<
  [prefix: string, ids: (values: PropertyFormValues) => string[]]
> = [
  ['Title is required', () => ['prop-title']],
  ['Expected rent', () => ['prop-bts-rent']],
  ['Rent per month', () => ['prop-rent']],
  [
    'Maintenance',
    (v) => [
      v.listingType === 'Built to Suit'
        ? 'prop-bts-maintenance'
        : 'prop-maintenance',
    ],
  ],
  ['Expected project value', () => ['prop-jv-price']],
  ['Price must', () => ['prop-price']],
  [
    'Advance',
    (v) => [
      v.listingType === 'JV/JD'
        ? 'prop-jv-advance'
        : v.listingType === 'Built to Suit'
          ? 'prop-bts-advance'
          : 'prop-advance',
    ],
  ],
  [
    'GST',
    (v) => [v.listingType === 'Built to Suit' ? 'prop-bts-gst' : 'prop-gst'],
  ],
  ['Owner share %', () => ['prop-jv-owner-share']],
  ['Builder share %', () => ['prop-jv-builder-share']],
  ['Goodwill', () => ['prop-jv-goodwill']],
  ['Lease term', () => ['prop-bts-lease-years']],
  ['Lock-in', () => ['prop-bts-lockin-years']],
  ['Rent escalation', () => ['prop-bts-escalation']],
  [
    'Location search query',
    (v) =>
      [
        !(v.sublocality.trim() || v.searchQuery.trim()) && 'prop-search-query',
        !v.city.trim() && 'prop-city',
        !v.stateVal.trim() && 'prop-state',
      ].filter((id): id is string => Boolean(id)),
  ],
  ['Land Area', () => ['prop-land-area']],
];

export function propertyFormErrorFieldIds(
  message: string,
  values: PropertyFormValues
): string[] {
  const match = ERROR_FIELDS.find(([prefix]) => message.startsWith(prefix));
  return match ? match[1](values) : [];
}
