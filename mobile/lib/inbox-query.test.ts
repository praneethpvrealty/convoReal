import { describe, expect, it } from 'vitest';

import { INBOX_FILTERS } from '@shared/lib/conversations/inbox-filters';

import {
  INBOX_ID_CAP,
  activeConversationIds,
  closeReasonsMatching,
  inboxContactSearchFilter,
  inboxFilterPlan,
  inboxSearchFilter,
  activeIdsPage,
  nextActiveOffset,
  matchesLoadedSearch,
  INBOX_PAGE_SIZE,
} from './inbox-query';
import { needsReply, unanswered } from './reply-state';

const NOW = Date.parse('2026-10-31T12:00:00Z');

describe('[UIX-009] inbox filter plan', () => {
  it('has a plan for every chip', () => {
    for (const option of INBOX_FILTERS) {
      expect(inboxFilterPlan(option.value, NOW).order).toBeDefined();
    }
  });

  it('narrows unread and status chips on the server', () => {
    expect(inboxFilterPlan('unread', NOW).unreadOnly).toBe(true);
    expect(inboxFilterPlan('pending', NOW).status).toBe('pending');
    expect(inboxFilterPlan('all', NOW)).toEqual({
      order: { column: 'last_message_at', ascending: false },
    });
  });

  it('keeps every thread needsReply admits inside the needs-reply plan', () => {
    const plan = inboxFilterPlan('needs_reply', NOW);
    expect(plan.excludeClosed).toBe(true);
    expect(plan.or).toBe('awaiting_reply.eq.true,status.eq.pending');
    const awaiting = {
      status: 'open',
      awaiting_reply: true,
      last_customer_message_at: '2026-10-31T11:00:00Z',
    };
    const pendingHandoff = { status: 'pending', awaiting_reply: false };
    expect(needsReply(awaiting, NOW)).not.toBeNull();
    expect(needsReply(pendingHandoff, NOW)).not.toBeNull();
    expect(
      needsReply({ status: 'open', awaiting_reply: false }, NOW)
    ).toBeNull();
  });

  it('matches unanswered to the grace period and never-answered threads', () => {
    const plan = inboxFilterPlan('unanswered', NOW);
    expect(plan.neverAnswered).toBe(true);
    expect(plan.notAwaiting).toBe(true);
    expect(plan.lastMessageBefore).toBe('2026-10-31T11:00:00.000Z');
    expect(
      unanswered(
        {
          status: 'open',
          awaiting_reply: false,
          last_message_at: '2026-10-31T10:59:00Z',
        },
        NOW
      )
    ).not.toBeNull();
    expect(
      unanswered(
        {
          status: 'open',
          awaiting_reply: false,
          last_message_at: '2026-10-31T11:30:00Z',
        },
        NOW
      )
    ).toBeNull();
  });
});

describe('[UIX-009] inbox search', () => {
  it('searches contacts by name and phone with punctuation stripped', () => {
    expect(inboxContactSearchFilter('Rao, (K)')).toBe(
      'name.ilike."%Rao K%",phone.ilike."%Rao K%"'
    );
    expect(inboxContactSearchFilter('+91 97006 06010')).toBe(
      'name.ilike."%+91 97006 06010%",phone.ilike."%+91 97006 06010%",phone.ilike."%919700606010%"'
    );
    expect(inboxContactSearchFilter('()')).toBeNull();
  });

  it('finds threads by close reason label', () => {
    expect(closeReasonsMatching('not respond')).toEqual(['not_responding']);
    expect(closeReasonsMatching('  ')).toEqual([]);
  });

  it('combines every branch and caps the id lists', () => {
    const ids = Array.from({ length: INBOX_ID_CAP + 5 }, (_, i) => `c${i}`);
    const filter = inboxSearchFilter('villa', ids, ['m1', 'c0']);
    expect(filter).toContain('last_message_text.ilike."%villa%"');
    expect(filter).toContain('close_note.ilike."%villa%"');
    expect(filter).toContain(',m1)');
    expect(filter).not.toContain('contact_id.in');
    expect(filter?.match(/\bc0\b/g)).toHaveLength(1);
    expect(filter).not.toContain(`c${INBOX_ID_CAP},`);
    expect(inboxSearchFilter('()', [], [])).toBeNull();
  });

  it('ranks the Active chip by the day’s message count', () => {
    expect(
      activeConversationIds([
        { conversation_id: 'a', message_count: 1 },
        { conversation_id: 'b', message_count: 9 },
      ])
    ).toEqual(['b', 'a']);
  });
});

describe('[UIX-009] inbox paging and short searches', () => {
  it('pages the Active chip in ranked order', () => {
    const ids = Array.from({ length: 90 }, (_, i) => `t${i}`);
    expect(activeIdsPage(ids, 0)).toEqual(ids.slice(0, INBOX_PAGE_SIZE));
    expect(activeIdsPage(ids, INBOX_PAGE_SIZE)[0]).toBe(`t${INBOX_PAGE_SIZE}`);
    expect(nextActiveOffset(ids, 1)).toBe(INBOX_PAGE_SIZE);
    expect(nextActiveOffset(ids, 3)).toBeUndefined();
  });

  it('filters loaded threads for a one-character search', () => {
    const row = {
      last_message_text: 'Site visit tomorrow',
      close_note: null,
      contact: { name: 'Ravi', phone: '+919900277111' },
    };
    expect(matchesLoadedSearch(row, 'r')).toBe(true);
    expect(matchesLoadedSearch(row, '7')).toBe(true);
    expect(matchesLoadedSearch(row, 'z')).toBe(false);
    expect(matchesLoadedSearch(row, ' ')).toBe(true);
  });
});
