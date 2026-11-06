import { CONVERSATION_CLOSE_REASONS } from './closure';
import type { InboxFilterValue } from './inbox-filters';
import { ilikeTerm } from '../postgrest-search';
import { UNANSWERED_GRACE_MS } from '../whatsapp/reply-state';

export const INBOX_PAGE_SIZE = 50;

export const INBOX_ID_CAP = 100;

export interface InboxFilterPlan {
  status?: 'open' | 'pending' | 'closed';
  excludeClosed?: boolean;
  unreadOnly?: boolean;
  or?: string;
  neverAnswered?: boolean;
  notAwaiting?: boolean;
  lastMessageBefore?: string;
  order: {
    column: 'last_message_at' | 'last_customer_message_at';
    ascending: boolean;
  };
}

export function inboxFilterPlan(
  filter: InboxFilterValue,
  now: number = Date.now()
): InboxFilterPlan {
  const newest = { column: 'last_message_at', ascending: false } as const;
  switch (filter) {
    case 'unread':
      return { unreadOnly: true, order: newest };
    case 'open':
    case 'pending':
    case 'closed':
      return { status: filter, order: newest };
    case 'needs_reply':
      return {
        excludeClosed: true,
        or: 'awaiting_reply.eq.true,status.eq.pending',
        order: { column: 'last_customer_message_at', ascending: true },
      };
    case 'unanswered':
      return {
        excludeClosed: true,
        neverAnswered: true,
        notAwaiting: true,
        lastMessageBefore: new Date(now - UNANSWERED_GRACE_MS).toISOString(),
        order: { column: 'last_message_at', ascending: true },
      };
    default:
      return { order: newest };
  }
}

export function closeReasonsMatching(search: string): string[] {
  const q = search.trim().toLowerCase();
  if (!q) return [];
  return CONVERSATION_CLOSE_REASONS.filter((option) =>
    option.label.toLowerCase().includes(q)
  ).map((option) => option.value);
}

export function inboxContactSearchFilter(search: string): string | null {
  const term = ilikeTerm(search);
  if (!term) return null;
  const branches = [`name.ilike."%${term}%"`, `phone.ilike."%${term}%"`];
  const digits = search.replace(/\D/g, '');
  if (digits.length >= 4 && digits !== term) {
    branches.push(`phone.ilike."%${digits}%"`);
  }
  return branches.join(',');
}

export function inboxSearchFilter(
  search: string,
  contactThreadIds: readonly string[],
  messageHitIds: readonly string[]
): string | null {
  const branches: string[] = [];
  const term = ilikeTerm(search);
  if (term) {
    branches.push(
      `last_message_text.ilike."%${term}%"`,
      `close_note.ilike."%${term}%"`
    );
  }
  const reasons = closeReasonsMatching(search);
  if (reasons.length > 0)
    branches.push(`close_reason.in.(${reasons.join(',')})`);
  const ids = [
    ...new Set([
      ...contactThreadIds.slice(0, INBOX_ID_CAP),
      ...messageHitIds.slice(0, INBOX_ID_CAP),
    ]),
  ];
  if (ids.length > 0) branches.push(`id.in.(${ids.join(',')})`);
  return branches.length > 0 ? branches.join(',') : null;
}

export function activeConversationIds(
  activity: readonly { conversation_id: string; message_count: number }[]
): string[] {
  return [...activity]
    .sort((a, b) => Number(b.message_count) - Number(a.message_count))
    .slice(0, INBOX_ID_CAP)
    .map((row) => row.conversation_id);
}

export function inboxNextOffset(
  pages: readonly (readonly unknown[])[],
  pageSize: number = INBOX_PAGE_SIZE
): number | undefined {
  const last = pages[pages.length - 1];
  if (!last || last.length < pageSize) return undefined;
  return pages.reduce((sum, page) => sum + page.length, 0);
}

export function inboxRows<T extends { id: string }>(
  pages: readonly (readonly T[])[],
  pinned?: T | null
): T[] {
  const seen = new Set<string>();
  const rows: T[] = [];
  for (const row of pages.flat()) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  if (pinned && !seen.has(pinned.id)) rows.unshift(pinned);
  return rows;
}
