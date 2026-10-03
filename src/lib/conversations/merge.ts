import type { Conversation } from '@/types';

export interface MergeConversationsOptions {
  activeId: string | null;
  previouslyLoadedIds: ReadonlySet<string>;
}

export function mergeConversations(
  prev: Conversation[],
  loaded: Conversation[],
  { activeId, previouslyLoadedIds }: MergeConversationsOptions
): Conversation[] {
  const clearActive = (c: Conversation) =>
    c.id === activeId ? { ...c, unread_count: 0 } : c;

  if (prev.length === 0) return loaded.map(clearActive);

  const prevMap = new Map(prev.map((c) => [c.id, c]));
  const loadedMap = new Map(loaded.map((c) => [c.id, c]));
  const result: Conversation[] = [];

  for (const fresh of loaded) {
    const existing = prevMap.get(fresh.id);
    if (!existing) {
      result.push(clearActive(fresh));
      continue;
    }
    const unread = fresh.id === activeId ? 0 : fresh.unread_count;
    const unchanged =
      existing.unread_count === unread &&
      existing.last_message_at === fresh.last_message_at &&
      existing.last_message_text === fresh.last_message_text &&
      existing.status === fresh.status &&
      existing.is_archived === fresh.is_archived;
    result.push(
      unchanged ? existing : { ...existing, ...fresh, unread_count: unread }
    );
  }

  for (const existing of prev) {
    if (!loadedMap.has(existing.id) && !previouslyLoadedIds.has(existing.id)) {
      result.push(existing);
    }
  }

  return result;
}
