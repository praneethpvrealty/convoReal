import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearPendingShare,
  pendingShareBubbles,
  pendingSharesFor,
  resetPendingShares,
  settlePendingShare,
  shareOutcomeNotice,
  stagePendingShare,
} from './pending-share';

/**
 * A single-recipient share hands the agent to the thread before the
 * server answers. The thread must find the bubbles it should draw, the
 * outcome must reach the share it belongs to — and only that share,
 * even when two are in flight to the same contact — and a thread that
 * was never staged must never be told anything.
 */

beforeEach(() => {
  resetPendingShares();
});

describe('pendingShareBubbles', () => {
  it('draws the photo first and the message after it, newest first', () => {
    const bubbles = pendingShareBubbles({
      conversationId: 'conv-1',
      text: 'Hi Salman, sharing a listing',
      image: 'https://proj.supabase.co/storage/v1/object/public/property-images/a/front.jpg',
      caption: '4180 Sq.Ft. Commercial Plot',
      now: 1_700_000_000_000,
    });
    expect(bubbles.map((m) => m.content_type)).toEqual(['text', 'image']);
    expect(bubbles.every((m) => m.status === 'sending')).toBe(true);
    expect(bubbles.every((m) => m.conversation_id === 'conv-1')).toBe(true);
    expect(bubbles[1].media_url).toContain('front.jpg');
    expect(bubbles[1].content_text).toBe('4180 Sq.Ft. Commercial Plot');
    expect(bubbles[0].created_at > bubbles[1].created_at).toBe(true);
  });

  it('draws only the message when the listing has no photo', () => {
    const bubbles = pendingShareBubbles({ conversationId: 'conv-1', text: 'Hi' });
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].content_type).toBe('text');
  });
});

describe('staged shares', () => {
  it('stages a share for its thread and settles it with the outcome', () => {
    const bubbles = pendingShareBubbles({ conversationId: 'conv-1', text: 'Hi' });
    const id = stagePendingShare('conv-1', bubbles);
    expect(pendingSharesFor('conv-1')).toEqual([
      { id, conversationId: 'conv-1', bubbles, outcome: null },
    ]);
    expect(pendingSharesFor('conv-2')).toEqual([]);

    settlePendingShare(id, { sent: true });
    expect(pendingSharesFor('conv-1')[0].outcome).toEqual({ sent: true });
  });

  it('keeps two in-flight shares to the same contact apart', () => {
    const first = stagePendingShare(
      'conv-1',
      pendingShareBubbles({ conversationId: 'conv-1', text: 'Listing A' })
    );
    const second = stagePendingShare(
      'conv-1',
      pendingShareBubbles({ conversationId: 'conv-1', text: 'Listing B' })
    );
    expect(pendingSharesFor('conv-1').map((s) => s.id)).toEqual([first, second]);

    settlePendingShare(first, { sent: false, error: 'Meta said no' });
    const [a, b] = pendingSharesFor('conv-1');
    expect(a.outcome).toEqual({ sent: false, error: 'Meta said no' });
    expect(a.bubbles[0].content_text).toBe('Listing A');
    expect(b.outcome).toBeNull();

    clearPendingShare(first);
    expect(pendingSharesFor('conv-1').map((s) => s.id)).toEqual([second]);
    expect(pendingSharesFor('conv-1')[0].bubbles[0].content_text).toBe('Listing B');
  });

  it('ignores an outcome for a share that was never staged', () => {
    settlePendingShare('share-nobody', { sent: false, error: 'x' });
    expect(pendingSharesFor('conv-9')).toEqual([]);
  });

  it('clears only the share the thread has reacted to', () => {
    const one = stagePendingShare(
      'conv-1',
      pendingShareBubbles({ conversationId: 'conv-1', text: 'Hi' })
    );
    const two = stagePendingShare(
      'conv-2',
      pendingShareBubbles({ conversationId: 'conv-2', text: 'Yo' })
    );
    clearPendingShare(one);
    expect(pendingSharesFor('conv-1')).toEqual([]);
    expect(pendingSharesFor('conv-2').map((s) => s.id)).toEqual([two]);
  });
});

describe('shareOutcomeNotice', () => {
  it('says nothing about a share that went out', () => {
    expect(shareOutcomeNotice({ sent: true, channel: 'freeform' }, 'Salman')).toBeNull();
  });

  it('explains a template still under review', () => {
    const notice = shareOutcomeNotice(
      { sent: false, templateStatus: 'PENDING' },
      'Salman'
    );
    expect(notice?.title).toBe('Template awaiting Meta approval');
    expect(notice?.message).toContain('Salman hasn’t messaged in the last 24 hours');
  });

  it('explains a template that was never set up', () => {
    const notice = shareOutcomeNotice({ sent: false, templateStatus: 'NONE' }, 'Salman');
    expect(notice?.title).toBe('One-time template setup needed');
    expect(notice?.message).toContain('Org Manager');
  });

  it('keeps an abandoned request apart from a refusal', () => {
    expect(shareOutcomeNotice({ sent: false, timedOut: true }, 'Salman')?.title).toBe(
      'Still sending'
    );
    expect(shareOutcomeNotice({ sent: false, error: 'Meta said no' }, 'Salman')).toEqual({
      title: 'Could not send',
      message: 'Meta said no',
    });
  });
});
