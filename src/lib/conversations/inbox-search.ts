import { conversationPreview, plainText } from './text-format';

export const INBOX_SEARCH_MIN_LENGTH = 2;

export interface InboxMessageHit {
  conversation_id: string;
  message_id: string;
  content_text: string;
  created_at: string;
}

export function inboxSearchTerm(raw: string): string {
  const term = raw.trim();
  return term.length >= INBOX_SEARCH_MIN_LENGTH ? term : '';
}

export function inboxMessageHitMap(
  rows: readonly InboxMessageHit[] | null | undefined
): Map<string, InboxMessageHit> {
  const map = new Map<string, InboxMessageHit>();
  for (const row of rows ?? []) {
    if (!map.has(row.conversation_id)) map.set(row.conversation_id, row);
  }
  return map;
}

export function searchSnippet(text: string, query: string, context = 32) {
  const flat = text.replace(/\s+/g, ' ').trim();
  const needle = query.trim().toLowerCase();
  const at = needle ? flat.toLowerCase().indexOf(needle) : -1;
  if (at <= context) return flat;
  const start = flat.lastIndexOf(' ', at - context);
  const from = start > 0 ? start + 1 : at - context;
  return `…${flat.slice(from)}`;
}

export function inboxSearchPreview(text: string, query: string): string {
  const needle = query.trim().toLowerCase();
  const preview = conversationPreview(text);
  if (!needle || preview.toLowerCase().includes(needle))
    return searchSnippet(preview, query);
  return searchSnippet(plainText(text), query);
}
