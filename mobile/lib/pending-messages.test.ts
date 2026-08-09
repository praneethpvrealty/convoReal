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

describe('settlePending — attachments', () => {
  it('retires an attachment once the row carrying the same upload lands', () => {
    const pending = [
      msg({ id: 'pending-1', content_type: 'image', media_url: '/media/a.jpg' }),
    ];
    const real = [msg({ id: 'real-1', content_type: 'image', media_url: '/media/a.jpg' })];
    expect(settlePending(pending, real)).toEqual([]);
  });

  it('keeps two captionless photos apart', () => {
    // Both have an empty caption; only the upload path tells them apart,
    // so keying on the caption would retire both on the first row.
    const pending = [
      msg({ id: 'pending-1', content_type: 'image', content_text: undefined, media_url: '/media/a.jpg' }),
      msg({ id: 'pending-2', content_type: 'image', content_text: undefined, media_url: '/media/b.jpg' }),
    ];
    const real = [
      msg({ id: 'real-1', content_type: 'image', content_text: undefined, media_url: '/media/a.jpg' }),
    ];
    expect(settlePending(pending, real).map((m) => m.id)).toEqual(['pending-2']);
  });

  it('cannot be retired while the file is still uploading', () => {
    // No path yet, so nothing real can claim to be this bubble.
    const pending = [
      msg({ id: 'pending-1', content_type: 'image', media_url: undefined, status: 'sending' }),
    ];
    const real = [msg({ id: 'real-1', content_type: 'image', media_url: '/media/a.jpg' })];
    expect(settlePending(pending, real)).toHaveLength(1);
  });

  it('ignores the caption when matching media', () => {
    // The server may normalise or drop a caption; the file is the truth.
    const pending = [
      msg({ id: 'pending-1', content_type: 'image', content_text: 'Look', media_url: '/media/a.jpg' }),
    ];
    const real = [
      msg({ id: 'real-1', content_type: 'image', content_text: undefined, media_url: '/media/a.jpg' }),
    ];
    expect(settlePending(pending, real)).toEqual([]);
  });
});

describe('settlePending — templates', () => {
  it('retires a template bubble when the rendered row lands', () => {
    const pending = [
      msg({ id: 'pending-1', content_type: 'template', content_text: 'Hi Asha, your viewing is confirmed.' }),
    ];
    const real = [
      msg({ id: 'real-1', content_type: 'template', content_text: 'Hi Asha, your viewing is confirmed.' }),
    ];
    expect(settlePending(pending, real)).toEqual([]);
  });

  it('does not let a plain text message retire a template bubble', () => {
    const pending = [msg({ id: 'pending-1', content_type: 'template', content_text: 'Same words' })];
    const real = [msg({ id: 'real-1', content_type: 'text', content_text: 'Same words' })];
    expect(settlePending(pending, real)).toHaveLength(1);
  });
});

describe('outgoingSignature', () => {
  it('keys text on the body', () => {
    expect(outgoingSignature({ content_type: 'text', content_text: ' hi ' })).toBe('text:hi');
  });

  it('keys media on the upload path, not the caption', () => {
    expect(
      outgoingSignature({ content_type: 'image', content_text: 'caption', media_url: '/m/a.jpg' })
    ).toBe('image:/m/a.jpg');
  });

  it('treats a missing body as empty rather than throwing', () => {
    expect(outgoingSignature({ content_type: 'template', content_text: undefined })).toBe(
      'template:'
    );
  });
});
