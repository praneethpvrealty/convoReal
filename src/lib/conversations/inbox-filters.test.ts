import { describe, expect, it } from 'vitest';

import {
  INBOX_FILTERS,
  PRIMARY_INBOX_FILTERS,
  inboxFilterTestId,
  isInboxFilterValue,
} from './inbox-filters';

describe('[UIX-006] inbox filters', () => {
  it('[UIX-006] offers the same filters in the same order on both surfaces', () => {
    expect(INBOX_FILTERS.map((f) => f.label)).toEqual([
      'All',
      'Needs reply',
      'Unanswered',
      'Unread',
      'Active',
      'Open',
      'Pending',
      'Closed',
      'Archived',
    ]);
    expect(PRIMARY_INBOX_FILTERS).toEqual(['all', 'needs_reply', 'unread']);
  });

  it('[UIX-006] accepts only known filter values', () => {
    expect(isInboxFilterValue('pending')).toBe(true);
    expect(isInboxFilterValue('unread')).toBe(true);
    expect(isInboxFilterValue('Unread')).toBe(false);
    expect(isInboxFilterValue(null)).toBe(false);
  });

  it('[UIX-006] keeps the mobile chip test ids the e2e flows tap', () => {
    expect(inboxFilterTestId('needs_reply')).toBe('inbox-filter-needs-reply');
    expect(inboxFilterTestId('unread')).toBe('inbox-filter-unread');
    expect(inboxFilterTestId('all')).toBe('inbox-filter-all');
  });
});
