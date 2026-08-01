import { describe, it, expect, vi, beforeEach } from 'vitest';

const parseEventFromInput = vi.fn();
const burnCredits = vi.fn();

vi.mock('@/lib/calendar/event-parse', async () => {
  const actual = await vi.importActual<typeof import('./event-parse')>('./event-parse');
  return { ...actual, parseEventFromInput: (...a: unknown[]) => parseEventFromInput(...a) };
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
  getMediaUrl: vi.fn(async () => ({ url: 'https://example.test/x', mimeType: 'image/jpeg' })),
  downloadMedia: vi.fn(async () => ({ buffer: Buffer.from('img') })),
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

beforeEach(() => {
  parseEventFromInput.mockReset();
  burnCredits.mockReset();
  burnCredits.mockResolvedValue({ success: true });
});

describe('tryHandleOwnerScheduling image handling', () => {
  it('defers an image on the pre-classification pass without spending anything', async () => {
    const handled = await tryHandleOwnerScheduling({
      ...baseParams,
      message: { id: 'm1', type: 'image' },
      contentText: 'schedule this',
    });

    expect(handled).toBe(false);
    expect(parseEventFromInput).not.toHaveBeenCalled();
    expect(burnCredits).not.toHaveBeenCalled();
  });

  it('parses the screenshot once the classifier hands the bytes over', async () => {
    parseEventFromInput.mockResolvedValue({ intent: 'none' });

    const handled = await tryHandleOwnerScheduling({
      ...baseParams,
      message: { id: 'm1', type: 'image' },
      image: { buffer: Buffer.from('screenshot'), mimeType: 'image/jpeg' },
      contentText: null,
    });

    expect(handled).toBe(false);
    expect(parseEventFromInput).toHaveBeenCalledTimes(1);
    expect(parseEventFromInput.mock.calls[0][0]).toMatchObject({
      image: { base64: Buffer.from('screenshot').toString('base64'), mimeType: 'image/jpeg' },
    });
    expect(burnCredits.mock.calls[0][1]).toBe('image_event_parse');
  });

  it('leaves the text path on the cheap tier', async () => {
    parseEventFromInput.mockResolvedValue({ intent: 'none' });

    await tryHandleOwnerScheduling({
      ...baseParams,
      message: { id: 'm1', type: 'text' },
      contentText: 'Remind me to call Snigdha tomorrow at 5pm',
    });

    expect(burnCredits.mock.calls[0][1]).toBe('event_parse');
    expect(parseEventFromInput.mock.calls[0][0].image).toBeUndefined();
  });
});
