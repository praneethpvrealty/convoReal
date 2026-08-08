// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

// ============================================================
// The hover toolbar on a message bubble.
//
// Two rules earn this file. "Send again" must never appear on a message
// the contact wrote — resending it would put their words out under our
// own number. And neither action may offer to re-send a body that is
// only the delivery-failure note the status webhook appended, which
// would mail our own error report to the customer.
// ============================================================

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

import {
  MessageActions,
  actionableText,
  canForward,
  canResend,
} from '@/components/inbox/message-actions';
import type { Message } from '@/types';
import { HIDE_ACTION_LABEL } from '@/lib/whatsapp/message-state';

function message(over: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    conversation_id: 'c1',
    sender_type: 'agent',
    content_type: 'text',
    content_text: 'Sharing the layout now',
    status: 'sent',
    created_at: '2026-08-06T07:00:00.000Z',
    ...over,
  } as Message;
}

function renderToolbar(msg: Message, handlers: { onTogglePin?: () => void; onHide?: () => void } = {}) {
  return render(
    <MessageActions
      message={msg}
      onReply={vi.fn()}
      onReact={vi.fn()}
      onResend={vi.fn()}
      onForward={vi.fn()}
      onTogglePin={handlers.onTogglePin ?? vi.fn()}
      onHide={handlers.onHide ?? vi.fn()}
    >
      <div>bubble</div>
    </MessageActions>
  );
}

afterEach(cleanup);

describe('actionable text', () => {
  it('drops the delivery-failure note the webhook appended', () => {
    expect(
      actionableText(
        message({
          content_text:
            'New Property Match\n\n❌ Delivery Failed:\n[Error 131049] not delivered',
        })
      )
    ).toBe('New Property Match');
  });

  it('has nothing to act on when the note is the whole body', () => {
    const onlyNote = message({
      status: 'failed',
      content_text: '❌ Delivery Failed:\n[Error 131049] not delivered',
    });
    expect(canResend(onlyNote)).toBe(false);
    expect(canForward(onlyNote)).toBe(false);
  });

  it('has nothing to act on for media, which carries no text', () => {
    const photo = message({ content_type: 'image', content_text: undefined });
    expect(canResend(photo)).toBe(false);
    expect(canForward(photo)).toBe(false);
  });
});

describe('MessageActions toolbar', () => {
  it('offers reply, send again and forward on our own message', () => {
    renderToolbar(message());
    expect(screen.getByLabelText('Reply')).toBeTruthy();
    expect(screen.getByLabelText('Send again')).toBeTruthy();
    expect(screen.getByLabelText('Forward')).toBeTruthy();
  });

  it("forwards the contact's message but never sends it again", () => {
    renderToolbar(message({ sender_type: 'customer' }));
    expect(screen.getByLabelText('Forward')).toBeTruthy();
    expect(screen.queryByLabelText('Send again')).toBeNull();
  });

  it('hides both on a message with no text to send', () => {
    renderToolbar(message({ content_type: 'image', content_text: undefined }));
    expect(screen.queryByLabelText('Send again')).toBeNull();
    expect(screen.queryByLabelText('Forward')).toBeNull();
    // Reply still stands: a photo can be quoted even if it cannot be re-sent.
    expect(screen.getByLabelText('Reply')).toBeTruthy();
  });
});

describe('pin and hide', () => {
  it('offers a pin on any message', () => {
    renderToolbar(message());
    expect(screen.getByLabelText('Pin')).toBeTruthy();
  });

  it('flips the label once a message is pinned', () => {
    renderToolbar(message({ pinned_at: '2026-08-08T10:00:00.000Z' }));
    expect(screen.getByLabelText('Unpin')).toBeTruthy();
  });

  it('never calls the hide action "delete for everyone"', () => {
    // The whole risk of this feature is an agent believing a message was
    // recalled from the customer's phone. It cannot be.
    renderToolbar(message());
    const hide = screen.getByLabelText(HIDE_ACTION_LABEL);
    expect(hide.getAttribute('title')).toMatch(/your inbox only/i);
    expect(screen.queryByLabelText(/everyone/i)).toBeNull();
  });

  it('reports the pin and hide taps to the caller', () => {
    const onTogglePin = vi.fn();
    const onHide = vi.fn();
    renderToolbar(message(), { onTogglePin, onHide });

    fireEvent.click(screen.getByLabelText('Pin'));
    expect(onTogglePin).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByLabelText(HIDE_ACTION_LABEL));
    expect(onHide).toHaveBeenCalledOnce();
  });
});
