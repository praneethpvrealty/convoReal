import { create } from 'zustand';

import type { EngineSendOutcome } from '@/lib/property-share-actions';
import type { Message } from '@/lib/types';

/**
 * A property share handed off to the thread while it is still sending.
 *
 * The share sheet used to hold the agent on a spinner for the whole
 * send — two WhatsApp round trips plus the bookkeeping around them —
 * before the thread opened. Now the sheet stages the photo and the
 * message here as `sending` bubbles, opens the thread at once, and
 * finishes the request in the background. The thread seeds the bubbles
 * into its pending list exactly as the composer's own sends appear,
 * and reacts to the outcome when it lands: a send that went out is
 * replaced by its real rows, a refusal is explained on the spot.
 *
 * Keyed by conversation so a thread only ever sees its own share.
 */
export interface StagedShare {
  bubbles: Message[];
  outcome: EngineSendOutcome | null;
}

interface PendingShareState {
  shares: Record<string, StagedShare>;
  stage: (conversationId: string, bubbles: Message[]) => void;
  settle: (conversationId: string, outcome: EngineSendOutcome) => void;
  clear: (conversationId: string) => void;
}

export const usePendingShareStore = create<PendingShareState>((set) => ({
  shares: {},
  stage: (conversationId, bubbles) =>
    set((state) => ({
      shares: { ...state.shares, [conversationId]: { bubbles, outcome: null } },
    })),
  settle: (conversationId, outcome) =>
    set((state) => {
      const staged = state.shares[conversationId];
      if (!staged) return {};
      return { shares: { ...state.shares, [conversationId]: { ...staged, outcome } } };
    }),
  clear: (conversationId) =>
    set((state) => {
      if (!(conversationId in state.shares)) return {};
      const shares = { ...state.shares };
      delete shares[conversationId];
      return { shares };
    }),
}));

/**
 * The bubbles a share draws before the server has written anything:
 * the listing photo first, then the message — the order the server
 * sends them in. Newest first, as the thread's pending list is kept.
 *
 * The text is drawn as composed here; the server may still tag the
 * showcase link and apply the contact's salutation, so the real row can
 * differ from it and is not relied on to retire the bubble by content.
 */
export function pendingShareBubbles(args: {
  conversationId: string;
  text: string;
  image?: string | null;
  caption?: string;
  now?: number;
}): Message[] {
  const now = args.now ?? Date.now();
  const stamp = `${now}-${Math.random().toString(36).slice(2, 8)}`;
  const bubbles: Message[] = [];
  if (args.image) {
    bubbles.push({
      id: `pending-share-photo-${stamp}`,
      conversation_id: args.conversationId,
      sender_type: 'agent',
      content_type: 'image',
      content_text: args.caption,
      media_url: args.image,
      status: 'sending',
      created_at: new Date(now).toISOString(),
    });
  }
  bubbles.push({
    id: `pending-share-text-${stamp}`,
    conversation_id: args.conversationId,
    sender_type: 'agent',
    content_type: 'text',
    content_text: args.text,
    status: 'sending',
    created_at: new Date(now + 1).toISOString(),
  });
  return bubbles.reverse();
}

/**
 * What to tell the agent about a share that did not go out, in the
 * same words the share sheet uses when it has to wait for the verdict
 * itself. Null when the share was sent.
 */
export function shareOutcomeNotice(
  outcome: EngineSendOutcome,
  contactLabel: string
): { title: string; message: string } | null {
  if (outcome.sent) return null;
  if (outcome.templateStatus) {
    const pending = outcome.templateStatus === 'PENDING';
    return {
      title: pending
        ? 'Template awaiting Meta approval'
        : 'One-time template setup needed',
      message: pending
        ? `${contactLabel} hasn’t messaged in the last 24 hours, so this share needs the approved property template — it’s still under review by Meta (usually minutes to a few hours). Try again once it’s approved, or send another approved template from this chat.`
        : `${contactLabel} hasn’t messaged in the last 24 hours, so WhatsApp requires a pre-approved template. An Org Manager can set up the property template once from Radar on the ConvoReal web app — after Meta approves it, shares like this go out automatically. For now, send an approved template from this chat.`,
    };
  }
  return {
    title: outcome.timedOut ? 'Still sending' : 'Could not send',
    message: outcome.timedOut
      ? 'WhatsApp is taking longer than usual to answer. The message may still go out — check this chat in a moment before sending it again.'
      : (outcome.error ?? 'Please try again.'),
  };
}
