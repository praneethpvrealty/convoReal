import { describe, expect, it } from 'vitest';

import { INBOX_FILTERS } from './inbox-filters';
import {
  INBOX_ID_CAP,
  INBOX_PAGE_SIZE,
  activeConversationIds,
  inboxContactSearchFilter,
  inboxFilterPlan,
  inboxNextOffset,
  inboxRows,
  inboxSearchFilter,
} from './inbox-page';

const NOW = Date.parse('2026-11-06T12:00:00Z');

describe('[UIX-012] web inbox paging', () => {
  it('has a server plan for every filter chip', () => {
    for (const option of INBOX_FILTERS) {
      expect(inboxFilterPlan(option.value, NOW).order).toBeDefined();
    }
    expect(inboxFilterPlan('unread', NOW).unreadOnly).toBe(true);
    expect(inboxFilterPlan('closed', NOW).status).toBe('closed');
    expect(inboxFilterPlan('unanswered', NOW).lastMessageBefore).toBe(
      '2026-11-06T11:00:00.000Z'
    );
  });

  it('asks for the next page only while the last one came back full', () => {
    const full = Array.from({ length: INBOX_PAGE_SIZE }, (_, i) => i);
    expect(inboxNextOffset([full])).toBe(INBOX_PAGE_SIZE);
    expect(inboxNextOffset([full, [1, 2]])).toBeUndefined();
    expect(inboxNextOffset([])).toBeUndefined();
  });

  it('puts a deep-linked conversation missing from the pages first, once', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    expect(inboxRows([[a, b], [b]])).toEqual([a, b]);
    expect(inboxRows([[a]], { id: 'pinned' })).toEqual([{ id: 'pinned' }, a]);
    expect(inboxRows([[a]], a)).toEqual([a]);
  });

  it('searches contacts by name and phone digits, tolerating punctuation', () => {
    expect(inboxContactSearchFilter('Ravi (HSR)')).toBe(
      'name.ilike."%Ravi HSR%",phone.ilike."%Ravi HSR%"'
    );
    expect(inboxContactSearchFilter('98450 12345')).toContain(
      'phone.ilike."%9845012345%"'
    );
  });

  it('folds contact and message hits into one bounded id list', () => {
    const many = Array.from({ length: INBOX_ID_CAP + 20 }, (_, i) => `c${i}`);
    const filter = inboxSearchFilter('not responding', many, ['m1', 'c1'])!;
    expect(filter).toContain('close_reason.in.(not_responding)');
    const ids = filter.match(/id\.in\.\(([^)]*)\)/)![1].split(',');
    expect(ids).toHaveLength(INBOX_ID_CAP + 1);
    expect(ids).toContain('m1');
  });

  it('ranks the Active chip by message count', () => {
    expect(
      activeConversationIds([
        { conversation_id: 'quiet', message_count: 1 },
        { conversation_id: 'busy', message_count: 9 },
      ])
    ).toEqual(['busy', 'quiet']);
  });
});
