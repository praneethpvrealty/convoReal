/**
 * The inbox filter chips, in the order both surfaces offer them. The
 * mobile app bundles this file through `@shared/`, so it must stay free
 * of imports.
 */

export const INBOX_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'needs_reply', label: 'Needs reply' },
  { value: 'unanswered', label: 'Unanswered' },
  { value: 'unread', label: 'Unread' },
  { value: 'active', label: 'Active' },
  { value: 'open', label: 'Open' },
  { value: 'pending', label: 'Pending' },
  { value: 'closed', label: 'Closed' },
  { value: 'archived', label: 'Archived' },
] as const;

export type InboxFilterValue = (typeof INBOX_FILTERS)[number]['value'];

export const PRIMARY_INBOX_FILTERS: readonly InboxFilterValue[] = [
  'all',
  'needs_reply',
  'unread',
];

export function isInboxFilterValue(value: unknown): value is InboxFilterValue {
  return INBOX_FILTERS.some((option) => option.value === value);
}

export function inboxFilterTestId(value: InboxFilterValue): string {
  return `inbox-filter-${value.replace(/_/g, '-')}`;
}
