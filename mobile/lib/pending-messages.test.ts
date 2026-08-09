import { describe, expect, it } from 'vitest';
import { outgoingSignature, settlePending } from './pending-messages';
import type { Message } from '@/lib/types';

/**
 * A pending bubble must disappear exactly once — when the real message
 * lands. Leave it too long and the thread shows the send twice; drop it
 * too early and the message blinks out between the API answering and
 * realtime delivering the row.
 */

function msg(over: Partial<Message>): Message {
  return {
    id: 'm1',
    conversation_id: 'c1',
    sender_type: 'agent',
    content_type: 'text',
    content_text: 'Hello there',
    status: 'sent',
    created_at: '2026-08-09T10:00:00Z',
    ...over,
  } as Message;
}

describe('settlePending', () => {
  it('keeps a bubble the thread has not caught up with', () => {
    const pending = [msg({ id: 'pending-1', status: 'sending' })];
    expect(settlePending(pending, [])).toHaveLength(1);
  });

  it('retires it once the real outgoing message lands', () => {
    const pending = [msg({ id: 'pending-1', status: 'sending' })];
    const real = [msg({ id: 'real-1', status: 'delivered' })];
    expect(settlePending(pending, real)).toEqual([]);
  });

  it('does not let an inbound echo of the same words retire it', () => {
    // The customer quoting us back is not our send arriving.
    const pending = [msg({ id: 'pending-1', status: 'sending' })];
    const real = [msg({ id: 'real-1', sender_type: 'customer' })];
    expect(settlePending(pending, real)).toHaveLength(1);
  });

  it('leaves a different send alone', () => {
    const pending = [msg({ id: 'pending-1', content_text: 'Second message' })];
    const real = [msg({ id: 'real-1', content_text: 'Hello there' })];
    expect(settlePending(pending, real)).toHaveLength(1);
  });

  it('ignores whitespace the composer trimmed off', () => {
    const pending = [msg({ id: 'pending-1', content_text: 'Hello there' })];
    const real = [msg({ id: 'real-1', content_text: '  Hello there  ' })];
    expect(settlePending(pending, real)).toEqual([]);
  });

  it('does not match across content types', () => {
    const pending = [msg({ id: 'pending-1', content_type: 'text' })];
    const real = [msg({ id: 'real-1', content_type: 'template' })];
    expect(settlePending(pending, real)).toHaveLength(1);
  });

  it('returns the same array when nothing is pending, so the memo stays stable', () => {
    const empty: Message[] = [];
    expect(settlePending(empty, [msg({})])).toBe(empty);
  });
});

describe('outgoingSignature', () => {
  it('treats a missing body as empty rather than throwing', () => {
    expect(outgoingSignature({ content_type: 'image', content_text: undefined })).toBe('image:');
  });
});
