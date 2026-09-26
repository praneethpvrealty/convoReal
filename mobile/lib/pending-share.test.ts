import { beforeEach, describe, expect, it } from 'vitest';

import {
  pendingShareBubbles,
  shareOutcomeNotice,
  usePendingShareStore,
} from './pending-share';

/**
 * A single-recipient share hands the agent to the thread before the
 * server answers. The thread must find the bubbles it should draw, the
 * outcome must reach it whenever it lands, and a thread that was never
 * staged must never be told anything.
 */

beforeEach(() => {
  usePendingShareStore.setState({ shares: {} });
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

describe('usePendingShareStore', () => {
  it('stages bubbles for one thread and settles them with the outcome', () => {
    const bubbles = pendingShareBubbles({ conversationId: 'conv-1', text: 'Hi' });
    usePendingShareStore.getState().stage('conv-1', bubbles);
    expect(usePendingShareStore.getState().shares['conv-1']).toEqual({
      bubbles,
      outcome: null,
    });

    usePendingShareStore.getState().settle('conv-1', { sent: true });
    expect(usePendingShareStore.getState().shares['conv-1']?.outcome).toEqual({
      sent: true,
    });
    expect(usePendingShareStore.getState().shares['conv-2']).toBeUndefined();
  });

  it('ignores an outcome for a thread that was never staged', () => {
    usePendingShareStore.getState().settle('conv-9', { sent: false, error: 'x' });
    expect(usePendingShareStore.getState().shares).toEqual({});
  });

  it('clears a thread once it has reacted', () => {
    usePendingShareStore
      .getState()
      .stage('conv-1', pendingShareBubbles({ conversationId: 'conv-1', text: 'Hi' }));
    usePendingShareStore
      .getState()
      .stage('conv-2', pendingShareBubbles({ conversationId: 'conv-2', text: 'Yo' }));
    usePendingShareStore.getState().clear('conv-1');
    expect(Object.keys(usePendingShareStore.getState().shares)).toEqual(['conv-2']);
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
