import { describe, expect, it } from 'vitest';

import {
  canForward,
  canResend,
  forwardSummary,
  forwardableText,
  messageAuthorLabel,
  messagePreview,
} from '@/lib/message-actions';
import type { Message } from '@/lib/types';

function message(over: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    conversation_id: 'c1',
    sender_type: 'agent',
    content_type: 'text',
    content_text: 'Hello there',
    status: 'sent',
    created_at: '2026-08-06T07:00:00.000Z',
    ...over,
  };
}

describe('messagePreview', () => {
  it('collapses whitespace so a multi-line body stays one line', () => {
    expect(
      messagePreview(message({ content_text: 'Price is\n\n1.8 Cr' }))
    ).toBe('Price is 1.8 Cr');
  });

  it('truncates past the limit', () => {
    const preview = messagePreview(
      message({ content_text: 'x'.repeat(200) }),
      10
    );
    expect(preview).toBe(`${'x'.repeat(10)}…`);
  });

  it('drops the delivery-failure note the webhook appended', () => {
    expect(
      messagePreview(
        message({
          content_text:
            '🏠 New Property Match\n\n❌ Delivery Failed:\n[Error 131049] not delivered',
        })
      )
    ).toBe('🏠 New Property Match');
  });

  it('names the media kind when there is no text', () => {
    expect(
      messagePreview(
        message({ content_type: 'image', content_text: undefined })
      )
    ).toBe('Photo');
    expect(
      messagePreview(message({ content_type: 'audio', content_text: '   ' }))
    ).toBe('Voice message');
  });
});

describe('messageAuthorLabel', () => {
  it('calls our own messages "You", whoever sent them', () => {
    expect(
      messageAuthorLabel(message({ sender_type: 'agent' }), 'Shankar')
    ).toBe('You');
    expect(messageAuthorLabel(message({ sender_type: 'bot' }), 'Shankar')).toBe(
      'You'
    );
  });

  it('names the contact on their messages, falling back when unnamed', () => {
    const inbound = message({ sender_type: 'customer' });
    expect(messageAuthorLabel(inbound, 'Shankar')).toBe('Shankar');
    expect(messageAuthorLabel(inbound, '  ')).toBe('Them');
    expect(messageAuthorLabel(inbound, null)).toBe('Them');
  });
});

describe('forwardable / resendable', () => {
  it('forwards anything with text, from either side', () => {
    expect(canForward(message({ sender_type: 'customer' }))).toBe(true);
    expect(canForward(message())).toBe(true);
  });

  it('refuses media, which has no text to put back on the wire', () => {
    const photo = message({ content_type: 'image', content_text: undefined });
    expect(forwardableText(photo)).toBe('');
    expect(canForward(photo)).toBe(false);
    expect(canResend(photo)).toBe(false);
  });

  it('resends what was composed, not the failure note attached to it', () => {
    const failed = message({
      status: 'failed',
      content_text:
        'Sharing the layout\n\n❌ Delivery Failed:\n[Error 131049] not delivered',
    });
    expect(forwardableText(failed)).toBe('Sharing the layout');
    expect(canResend(failed)).toBe(true);
  });

  it('has nothing to resend when the note is the whole body', () => {
    const failed = message({
      status: 'failed',
      content_text: '❌ Delivery Failed:\n[Error 131049] not delivered',
    });
    expect(canResend(failed)).toBe(false);
  });

  it('only resends our own messages', () => {
    expect(canResend(message({ sender_type: 'agent' }))).toBe(true);
    expect(canResend(message({ sender_type: 'bot' }))).toBe(true);
    expect(canResend(message({ sender_type: 'customer' }))).toBe(false);
  });
});

describe('forwardSummary', () => {
  it('says nothing when every recipient got it', () => {
    expect(
      forwardSummary([
        { contact_id: 'a', name: 'Asha', sent: true },
        { contact_id: 'b', name: 'Bala', sent: true },
      ])
    ).toBeNull();
  });

  it('separates a closed window from a real failure', () => {
    const summary = forwardSummary([
      { contact_id: 'a', name: 'Asha', sent: true },
      { contact_id: 'b', name: 'Bala', sent: false, window_closed: true },
      { contact_id: 'c', name: 'Chetan', sent: false, error: 'Invalid phone' },
    ]);
    expect(summary?.title).toBe('Forwarded to 1 of 3');
    expect(summary?.message).toContain('Bala');
    expect(summary?.message).toContain('24 hours');
    expect(summary?.message).toContain('Could not send to: Chetan.');
  });

  it('titles a total failure as such', () => {
    const summary = forwardSummary([
      { contact_id: 'b', name: 'Bala', sent: false, window_closed: true },
    ]);
    expect(summary?.title).toBe('Nothing was forwarded');
  });
});
