import { describe, expect, it } from 'vitest';
import type { Conversation } from '@/types';
import { mergeConversations } from '@/lib/conversations/merge';

function conv(id: string, overrides: Partial<Conversation> = {}): Conversation {
  return {
    id,
    account_id: 'acct-1',
    contact_id: `contact-${id}`,
    status: 'open',
    unread_count: 1,
    is_archived: false,
    last_message_at: '2026-10-03T10:00:00.000Z',
    last_message_text: `hello ${id}`,
    ...overrides,
  } as Conversation;
}

const none = new Set<string>();

describe('mergeConversations', () => {
  it('takes the loaded list as is on first load, clearing the active unread', () => {
    const result = mergeConversations([], [conv('a'), conv('b')], {
      activeId: 'b',
      previouslyLoadedIds: none,
    });
    expect(result.map((c) => [c.id, c.unread_count])).toEqual([
      ['a', 1],
      ['b', 0],
    ]);
  });

  it('keeps unchanged rows by reference and patches changed ones in fetched order', () => {
    const a = conv('a');
    const b = conv('b');
    const result = mergeConversations(
      [a, b],
      [conv('b', { last_message_text: 'newer' }), conv('a')],
      { activeId: null, previouslyLoadedIds: new Set(['a', 'b']) }
    );
    expect(result.map((c) => c.id)).toEqual(['b', 'a']);
    expect(result[1]).toBe(a);
    expect(result[0]).not.toBe(b);
    expect(result[0].last_message_text).toBe('newer');
  });

  it('drops a cached row the authoritative refetch no longer returns', () => {
    const cached = [conv('gone'), conv('kept')];
    const result = mergeConversations(cached, [conv('kept')], {
      activeId: null,
      previouslyLoadedIds: new Set(['gone', 'kept']),
    });
    expect(result.map((c) => c.id)).toEqual(['kept']);
  });

  it('keeps a local-only row the server has not returned yet', () => {
    const optimistic = conv('new-local');
    const result = mergeConversations(
      [optimistic, conv('kept')],
      [conv('kept')],
      {
        activeId: null,
        previouslyLoadedIds: new Set(['kept']),
      }
    );
    expect(result.map((c) => c.id)).toEqual(['kept', 'new-local']);
  });
});
