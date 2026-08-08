// Reactions as the thread needs them: grouped for the little pill under a
// bubble, and the toggle rule that decides what a tap sends.
//
// Transport-free, like message-actions.ts — POST /api/whatsapp/react takes
// the emoji this module works out, or '' to withdraw.

import type { Message, MessageReaction } from '@/lib/types';

/** WhatsApp's own quick-reaction bar. The web thread offers the same six
 *  (src/components/inbox/message-actions.tsx), so a reaction picked on one
 *  surface reads the same on the other. */
export const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/** What a double-tap sends, as on WhatsApp. */
export const DOUBLE_TAP_EMOJI = '❤️';

export interface ReactionGroup {
  emoji: string;
  count: number;
  /** Whether the signed-in agent is one of the reactors — the pill is
   *  tinted for them, and tapping it withdraws rather than piles on. */
  mine: boolean;
}

function isMine(reaction: MessageReaction, userId?: string | null): boolean {
  return (
    reaction.actor_type === 'agent' && !!userId && reaction.actor_id === userId
  );
}

/** One entry per distinct emoji, in the order they were first reacted. */
export function groupReactions(
  reactions: MessageReaction[],
  userId?: string | null
): ReactionGroup[] {
  const groups = new Map<string, ReactionGroup>();
  for (const reaction of reactions) {
    const existing = groups.get(reaction.emoji);
    if (existing) {
      existing.count += 1;
      existing.mine = existing.mine || isMine(reaction, userId);
    } else {
      groups.set(reaction.emoji, {
        emoji: reaction.emoji,
        count: 1,
        mine: isMine(reaction, userId),
      });
    }
  }
  return [...groups.values()];
}

/** Split a conversation's reactions by the message they sit on, so each
 *  bubble reads its own without scanning the whole thread. */
export function reactionsByMessage(
  reactions: MessageReaction[]
): Map<string, MessageReaction[]> {
  const byMessage = new Map<string, MessageReaction[]>();
  for (const reaction of reactions) {
    const existing = byMessage.get(reaction.message_id);
    if (existing) existing.push(reaction);
    else byMessage.set(reaction.message_id, [reaction]);
  }
  return byMessage;
}

/** The agent's current reaction on a message, if they left one. An agent
 *  has at most one: the table is unique on (message, actor). */
export function myReaction(
  reactions: MessageReaction[],
  userId?: string | null
): string | undefined {
  return reactions.find((r) => isMine(r, userId))?.emoji;
}

/**
 * What to send when the agent taps `emoji`. Tapping the one they already
 * left withdraws it (''); anything else replaces it, which the route's
 * upsert does in a single statement.
 */
export function toggleEmoji(
  reactions: MessageReaction[],
  userId: string | null | undefined,
  emoji: string
): string {
  return myReaction(reactions, userId) === emoji ? '' : emoji;
}

/**
 * Whether this message can carry a reaction at all. Meta reacts to a
 * wamid, so a send still queued — or one that failed — has nothing to
 * point at, and the route refuses it with a 400. Better to not offer the
 * gesture than to explain the refusal afterwards.
 */
export function canReact(message: Message): boolean {
  return Boolean(message.message_id);
}
