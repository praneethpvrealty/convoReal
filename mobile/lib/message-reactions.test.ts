import { describe, expect, it } from 'vitest';

import {
  canReact,
  groupReactions,
  myReaction,
  reactionsByMessage,
  toggleEmoji,
} from './message-reactions';
import type { Message, MessageReaction } from './types';

const ME = 'agent-1';

function reaction(over: Partial<MessageReaction> = {}): MessageReaction {
  return {
    id: Math.random().toString(36).slice(2),
    message_id: 'm1',
    conversation_id: 'c1',
    actor_type: 'agent',
    actor_id: ME,
    emoji: '👍',
    created_at: '2026-08-08T10:00:00Z',
    ...over,
  };
}

function message(over: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    conversation_id: 'c1',
    sender_type: 'agent',
    content_type: 'text',
    content_text: 'hello',
    status: 'sent',
    created_at: '2026-08-08T10:00:00Z',
    message_id: 'wamid.abc',
    ...over,
  };
}

describe('groupReactions', () => {
  it('counts each emoji once', () => {
    const groups = groupReactions([
      reaction({ emoji: '👍', actor_type: 'customer', actor_id: null }),
      reaction({ emoji: '👍', actor_id: ME }),
      reaction({ emoji: '😂', actor_type: 'customer', actor_id: null }),
    ], ME);
    expect(groups).toEqual([
      { emoji: '👍', count: 2, mine: true },
      { emoji: '😂', count: 1, mine: false },
    ]);
  });

  it('does not credit another agent’s reaction to me', () => {
    const groups = groupReactions([reaction({ actor_id: 'agent-2' })], ME);
    expect(groups[0].mine).toBe(false);
  });

  it('never claims a customer reaction as mine, even with a matching id', () => {
    const groups = groupReactions(
      [reaction({ actor_type: 'customer', actor_id: ME })],
      ME
    );
    expect(groups[0].mine).toBe(false);
  });

  it('claims nothing when nobody is signed in', () => {
    expect(groupReactions([reaction()], undefined)[0].mine).toBe(false);
  });

  it('returns nothing for a message nobody reacted to', () => {
    expect(groupReactions([], ME)).toEqual([]);
  });
});

describe('reactionsByMessage', () => {
  it('buckets by message id', () => {
    const map = reactionsByMessage([
      reaction({ message_id: 'a' }),
      reaction({ message_id: 'b' }),
      reaction({ message_id: 'a', emoji: '🙏' }),
    ]);
    expect(map.get('a')).toHaveLength(2);
    expect(map.get('b')).toHaveLength(1);
    expect(map.get('c')).toBeUndefined();
  });
});

describe('myReaction', () => {
  it('finds the agent’s own emoji', () => {
    expect(myReaction([reaction({ emoji: '🙏' })], ME)).toBe('🙏');
  });

  it('is undefined when only others reacted', () => {
    expect(myReaction([reaction({ actor_id: 'agent-2' })], ME)).toBeUndefined();
  });
});

describe('toggleEmoji', () => {
  it('withdraws the emoji already left', () => {
    expect(toggleEmoji([reaction({ emoji: '❤️' })], ME, '❤️')).toBe('');
  });

  it('swaps to a different emoji', () => {
    expect(toggleEmoji([reaction({ emoji: '❤️' })], ME, '😂')).toBe('😂');
  });

  it('adds when nothing is there yet', () => {
    expect(toggleEmoji([], ME, '👍')).toBe('👍');
  });

  it('does not withdraw the contact’s reaction', () => {
    const theirs = reaction({ actor_type: 'customer', actor_id: null, emoji: '❤️' });
    expect(toggleEmoji([theirs], ME, '❤️')).toBe('❤️');
  });
});

describe('canReact', () => {
  it('allows a message WhatsApp has accepted', () => {
    expect(canReact(message())).toBe(true);
  });

  it('refuses one still queued or failed', () => {
    expect(canReact(message({ message_id: null, status: 'sending' }))).toBe(false);
    expect(canReact(message({ message_id: undefined, status: 'failed' }))).toBe(false);
  });
});
