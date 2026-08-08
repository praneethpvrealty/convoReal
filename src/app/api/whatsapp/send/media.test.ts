import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/whatsapp/send, media branch — the second half of an
 * attachment or voice note.
 *
 * Three things are load-bearing. `media_url` is a path this account
 * staged, never a link the caller names, or the business number becomes
 * a fetcher for whatever URL it is handed. Media is free-form, so past
 * the 24-hour window it must be refused here rather than accepted by
 * Meta and failed asynchronously. And what reaches the dispatcher has
 * to match what each kind renders: no caption on audio, no filename on
 * anything but a document.
 */

import { encrypt } from '@/lib/whatsapp/encryption';

const ACCOUNT = 'acc-1';
const CONVERSATION = 'conv-1';

let lastCustomerAt: string | null;
let integrationType: string;
let replyParent: { message_id: string | null; conversation_id: string } | null;
let dispatched: Record<string, unknown> | null;

function makeDb() {
  const builder = (table: string) => {
    const chain: Record<string, (...args: unknown[]) => unknown> = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      update: () => chain,
      single: async () => {
        if (table === 'conversations') {
          return {
            data: {
              id: CONVERSATION,
              account_id: ACCOUNT,
              contact: { id: 'contact-1', phone: '+919876543210' },
            },
            error: null,
          };
        }
        if (table === 'whatsapp_config') {
          return {
            data: {
              id: 'cfg-1',
              account_id: ACCOUNT,
              access_token: encrypt('meta-token'),
              integration_type: integrationType,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
      maybeSingle: async () => {
        if (table === 'messages') {
          // The reply lookup runs before the window lookup, and only
          // when the caller quoted something.
          if (replyParent) {
            const parent = replyParent;
            replyParent = null;
            return { data: parent, error: null };
          }
          return {
            data: lastCustomerAt ? { created_at: lastCustomerAt } : null,
            error: null,
          };
        }
        return { data: null, error: null };
      },
      then: (...args: unknown[]) =>
        Promise.resolve({ data: null, error: null }).then(
          args[0] as (v: unknown) => unknown,
        ),
    };
    return chain;
  };
  return { from: (table: string) => builder(table) };
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    supabase: makeDb(),
    accountId: ACCOUNT,
    userId: 'user-1',
  }),
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 403 },
    ),
}));

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: async (args: Record<string, unknown>) => {
    dispatched = args;
    return { success: true, messageId: 'msg-1', whatsappMessageId: 'wamid.1' };
  },
}));

import { POST } from './route';

function send(body: Record<string, unknown>) {
  return POST(
    new Request('http://test/api/whatsapp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: CONVERSATION,
        message_type: 'media',
        ...body,
      }),
    }),
  );
}

const staged = (name = 'chat-1.jpeg') => `chat-media/${ACCOUNT}/${name}`;

beforeEach(() => {
  lastCustomerAt = new Date(Date.now() - 60_000).toISOString();
  integrationType = 'cloud_api';
  replyParent = null;
  dispatched = null;
});

describe('POST /api/whatsapp/send (media)', () => {
  it('sends a staged photo with its caption', async () => {
    const res = await send({
      media_url: staged(),
      media_kind: 'image',
      content_text: 'Front elevation',
    });

    expect(res.status).toBe(200);
    expect(dispatched).toMatchObject({
      kind: 'media',
      mediaKind: 'image',
      mediaLink: staged(),
      mediaCaption: 'Front elevation',
      senderType: 'agent',
    });
  });

  it('sends a voice note with no caption, which audio never renders', async () => {
    const res = await send({
      media_url: staged('voice-1.ogg'),
      media_kind: 'audio',
      content_text: 'listen to this',
    });

    expect(res.status).toBe(200);
    expect(dispatched).toMatchObject({ mediaKind: 'audio' });
    expect(dispatched!.mediaCaption).toBeUndefined();
    expect(dispatched!.mediaFilename).toBeUndefined();
  });

  it('keeps the filename only where WhatsApp shows one', async () => {
    await send({
      media_url: staged('chat-1.pdf'),
      media_kind: 'document',
      media_filename: 'Price list.pdf',
    });
    expect(dispatched!.mediaFilename).toBe('Price list.pdf');

    await send({
      media_url: staged(),
      media_kind: 'image',
      media_filename: 'Price list.pdf',
    });
    expect(dispatched!.mediaFilename).toBeUndefined();
  });

  it('refuses a media_url outside this account, however staged it looks', async () => {
    for (const url of [
      'chat-media/other-account/chat-1.jpeg',
      'https://evil.example/payload.pdf',
      'property-images/acc-1/img.jpg',
    ]) {
      const res = await send({ media_url: url, media_kind: 'image' });
      expect(res.status).toBe(400);
      expect(dispatched).toBeNull();
    }
  });

  it('requires a kind the dispatcher can switch on', async () => {
    const res = await send({ media_url: staged(), media_kind: 'sticker' });
    expect(res.status).toBe(400);
    expect(dispatched).toBeNull();
  });

  it('requires a media_url at all', async () => {
    const res = await send({ media_kind: 'image' });
    expect(res.status).toBe(400);
    expect(dispatched).toBeNull();
  });

  it('refuses past the 24-hour window instead of failing later', async () => {
    lastCustomerAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

    const res = await send({ media_url: staged(), media_kind: 'image' });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('CUSTOMER_WINDOW_EXPIRED');
    expect(dispatched).toBeNull();
  });

  it('lets sandbox send outside the window, having no real one', async () => {
    lastCustomerAt = null;
    integrationType = 'sandbox';

    const res = await send({ media_url: staged(), media_kind: 'image' });
    expect(res.status).toBe(200);
    expect(dispatched).toMatchObject({ kind: 'media' });
  });

  it('carries the quote through to the Meta context id', async () => {
    replyParent = { message_id: 'wamid.parent', conversation_id: CONVERSATION };

    await send({
      media_url: staged(),
      media_kind: 'image',
      reply_to_message_id: 'msg-parent',
    });

    expect(dispatched).toMatchObject({
      contextMessageId: 'wamid.parent',
      replyToMessageId: 'msg-parent',
    });
  });
});
