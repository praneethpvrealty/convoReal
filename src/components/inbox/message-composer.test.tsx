// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

// ============================================================
// The web composer's attach button and voice notes.
//
// A voice note is the one file the agent cannot re-pick if the send
// refuses it, so what the recorder produces has to be a container
// WhatsApp accepts before the microphone opens. The other rule is that
// "Discard" discards: the recorder's stop event fires on both paths, so
// nothing but the recorded intent separates them.
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/hooks/use-can', () => ({ useCan: () => true }));

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m) } }));

import { MessageComposer } from '@/components/inbox/message-composer';

/** GatedButton hangs the title on a wrapping span, so the click target
 *  is the button inside it. */
function clickGated(title: string) {
  const button = screen.getByTitle(title).querySelector('button');
  fireEvent.click(button as HTMLButtonElement);
}

/** "Discard" only exists while recording. */
const recordingBar = () => screen.queryByRole('button', { name: 'Discard' });

let supportedTypes: string[];
let recorder: FakeRecorder;

class FakeRecorder {
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType: string;
  started = false;

  constructor(options?: { mimeType?: string }) {
    // An unconstrained recorder is Chrome's webm — the container the
    // send refuses, and what the composer must not fall back to.
    this.mimeType = options?.mimeType ?? 'audio/webm;codecs=opus';
  }
  start() {
    this.started = true;
  }
  stop() {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(4096)]) });
    this.onstop?.();
  }
}

const MediaRecorderStub = Object.assign(
  function (_stream: unknown, options?: { mimeType?: string }) {
    recorder = new FakeRecorder(options);
    return recorder;
  },
  { isTypeSupported: (type: string) => supportedTypes.includes(type) },
);

const trackStop = vi.fn();

function renderComposer(onSendAttachment = vi.fn().mockResolvedValue(undefined)) {
  render(
    <MessageComposer
      conversationId="conv-1"
      sessionExpired={false}
      onSend={vi.fn()}
      onSendAttachment={onSendAttachment}
      onOpenTemplates={vi.fn()}
    />,
  );
  return onSendAttachment;
}

beforeEach(() => {
  supportedTypes = ['audio/ogg;codecs=opus', 'audio/webm'];
  toastError.mockClear();
  trackStop.mockClear();
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = MediaRecorderStub;
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: trackStop }],
      }),
    },
  });
});

afterEach(cleanup);

describe('attachments', () => {
  it('sends a picked file with whatever is typed as its caption', async () => {
    const onSendAttachment = renderComposer();

    fireEvent.change(screen.getByPlaceholderText(/Type a message/), {
      target: { value: 'Front elevation' },
    });
    const file = new File([new Uint8Array(16)], 'layout.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onSendAttachment).toHaveBeenCalled());
    expect(onSendAttachment.mock.calls[0][0]).toBe(file);
    expect(onSendAttachment.mock.calls[0][1]).toBe('Front elevation');
  });

  it('clears the picker so the same file can be retried', async () => {
    const onSendAttachment = renderComposer();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'layout.jpg', { type: 'image/jpeg' })] },
    });

    await waitFor(() => expect(onSendAttachment).toHaveBeenCalled());
    expect(input.value).toBe('');
  });

  it('offers only types WhatsApp accepts in the picker', () => {
    renderComposer();
    const accept = (document.querySelector('input[type="file"]') as HTMLInputElement).accept;
    expect(accept).toContain('image/jpeg');
    expect(accept).toContain('application/pdf');
    expect(accept).not.toContain('image/gif');
  });
});

describe('voice notes', () => {
  it('offers the mic until there is text to send', () => {
    renderComposer();
    expect(screen.getByTitle('Record a voice note')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(/Type a message/), {
      target: { value: 'hi' },
    });
    expect(screen.queryByTitle('Record a voice note')).toBeNull();
    expect(screen.getByTitle('Send')).toBeTruthy();
  });

  it('records in a container WhatsApp accepts, not the browser default', async () => {
    const onSendAttachment = renderComposer();

    clickGated('Record a voice note');
    await waitFor(() => expect(recordingBar()).not.toBeNull());
    expect(recorder.mimeType).toBe('audio/ogg;codecs=opus');

    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(onSendAttachment).toHaveBeenCalled());

    const sent = onSendAttachment.mock.calls[0][0] as File;
    expect(sent.type).toBe('audio/ogg;codecs=opus');
    expect(sent.name).toMatch(/^voice-\d+\.ogg$/);
    expect(trackStop).toHaveBeenCalled();
  });

  it('says so rather than recording what the send would refuse', async () => {
    supportedTypes = ['audio/webm', 'audio/webm;codecs=opus'];
    const onSendAttachment = renderComposer();

    clickGated('Record a voice note');

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(recordingBar()).toBeNull();
    expect(onSendAttachment).not.toHaveBeenCalled();
    expect(trackStop).toHaveBeenCalled();
  });

  it('discards a recording without sending it', async () => {
    const onSendAttachment = renderComposer();

    clickGated('Record a voice note');
    await waitFor(() => expect(recordingBar()).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(recordingBar()).toBeNull());
    expect(onSendAttachment).not.toHaveBeenCalled();
    expect(trackStop).toHaveBeenCalled();
  });

  it('drops a mis-click too short to be a message', async () => {
    const onSendAttachment = renderComposer();

    clickGated('Record a voice note');
    await waitFor(() => expect(recordingBar()).not.toBeNull());
    recorder.stop = function () {
      this.ondataavailable?.({ data: new Blob([new Uint8Array(200)]) });
      this.onstop?.();
    };
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));

    await waitFor(() => expect(recordingBar()).toBeNull());
    expect(onSendAttachment).not.toHaveBeenCalled();
  });

  it('leaves only discard and send on screen while recording', async () => {
    renderComposer();
    clickGated('Record a voice note');
    await waitFor(() => expect(recordingBar()).not.toBeNull());

    expect(screen.queryByPlaceholderText(/Type a message/)).toBeNull();
    expect(screen.queryByTitle('Attach a photo, video or document')).toBeNull();
  });
});
