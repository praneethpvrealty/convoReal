import { describe, it, expect, vi, beforeEach } from 'vitest';

const parseEventsFromInput = vi.fn();
const burnCredits = vi.fn();
const getMediaUrl = vi.fn(async () => ({ url: 'https://example.test/a', mimeType: 'audio/ogg' }));

vi.mock('@/lib/calendar/event-parse', async () => {
  const actual = await vi.importActual<typeof import('./event-parse')>('./event-parse');
  return { ...actual, parseEventsFromInput: (...a: unknown[]) => parseEventsFromInput(...a) };
});

vi.mock('@/lib/credits/burn', () => ({
  burnCredits: (...a: unknown[]) => burnCredits(...a),
}));

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => {
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => builder,
      insert: () => builder,
      update: () => builder,
      eq: () => builder,
      or: () => builder,
      gte: () => builder,
      lt: () => builder,
      order: () => builder,
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
        resolve({ data: [], error: null }),
    });
    return { from: () => builder };
  },
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: vi.fn(async () => ({ messageId: 'wamid.stub' })),
  getMediaUrl: (...a: unknown[]) => getMediaUrl(...(a as [])),
  downloadMedia: vi.fn(async () => ({ buffer: Buffer.from('opus') })),
}));

vi.mock('@/lib/notifications/create', () => ({ createNotification: vi.fn(async () => {}) }));

import { tryHandleOwnerScheduling } from './whatsapp-scheduler';

const baseParams = {
  contactRecord: { id: 'contact-1', phone: '+919876543210' },
  conversation: { id: 'conv-1' },
  accountId: 'acc-1',
  userId: 'user-1',
  accessToken: 'token',
  phoneNumberId: 'pnid',
};

const voiceMessage = { id: 'm1', type: 'audio', audio: { id: 'media-1', mime_type: 'audio/ogg' } };

beforeEach(() => {
  parseEventsFromInput.mockReset();
  burnCredits.mockReset();
  getMediaUrl.mockClear();
  burnCredits.mockResolvedValue({ success: true });
});

describe('tryHandleOwnerScheduling voice handling', () => {
  it('parses the transcript it was handed instead of fetching the clip again', async () => {
    parseEventsFromInput.mockResolvedValue([]);

    await tryHandleOwnerScheduling({
      ...baseParams,
      message: voiceMessage,
      contentText: 'Remind me to follow up with the advocate after a week',
    });

    expect(getMediaUrl).not.toHaveBeenCalled();
    expect(parseEventsFromInput.mock.calls[0][0]).toMatchObject({
      text: 'Remind me to follow up with the advocate after a week',
    });
    expect(parseEventsFromInput.mock.calls[0][0].audio).toBeUndefined();
    expect(burnCredits.mock.calls[0][1]).toBe('event_parse');
  });

  it('lets a transcribed voice note that is not an event fall through to intake', async () => {
    parseEventsFromInput.mockResolvedValue([]);

    const handled = await tryHandleOwnerScheduling({
      ...baseParams,
      message: voiceMessage,
      contentText: 'Three BHK in Whitefield, 1.2 crore, owner Ramesh',
    });

    expect(handled).toBe(false);
  });

  it('still transcribes inside the parse when only raw audio is given', async () => {
    parseEventsFromInput.mockResolvedValue([]);

    const handled = await tryHandleOwnerScheduling({
      ...baseParams,
      message: voiceMessage,
      contentText: null,
    });

    expect(getMediaUrl).toHaveBeenCalledTimes(1);
    expect(parseEventsFromInput.mock.calls[0][0].audio).toMatchObject({ mimeType: 'audio/ogg' });
    expect(burnCredits.mock.calls[0][1]).toBe('voice_event_parse');
    // No transcript to hand on to intake, so the dead end is still the
    // right answer here — and it is answered, not ignored.
    expect(handled).toBe(true);
  });

  it('answers a spoken agenda command for free', async () => {
    const handled = await tryHandleOwnerScheduling({
      ...baseParams,
      message: voiceMessage,
      contentText: 'today',
    });

    expect(handled).toBe(true);
    expect(burnCredits).not.toHaveBeenCalled();
    expect(parseEventsFromInput).not.toHaveBeenCalled();
  });

  it('files a dictated task list spoken out loud', async () => {
    const handled = await tryHandleOwnerScheduling({
      ...baseParams,
      message: voiceMessage,
      contentText: "Today's tasks 1) call the advocate 2) send Sharan the update",
    });

    expect(handled).toBe(true);
    expect(parseEventsFromInput).not.toHaveBeenCalled();
  });
});
