import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/whatsapp/media/upload-url — the first half of sending an
 * attachment or a voice note.
 *
 * What matters here is that a file Meta would refuse is refused now,
 * while the agent is still looking at the picker, and that what comes
 * back is exactly the shape /api/whatsapp/send will take: a path inside
 * this account's own prefix, plus the kind the dispatcher switches on.
 *
 * The bytes are not this route's business — they go to storage under
 * the signature it hands out, which is why the caps the composer
 * advertises are no longer capped in turn by a 4.5 MB request body.
 */

let role: 'agent' | 'viewer' = 'agent';
const signed: Array<{
  accountId: string;
  mimeType: string;
  filename?: string;
}> = [];

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => {
    if (role === 'viewer') throw new Error('Requires agent role');
    return { supabase: {}, accountId: 'acc-1', userId: 'user-1' };
  },
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 403 }
    ),
}));

vi.mock('@/lib/storage/chat-media', () => ({
  signChatMediaUpload: async (
    accountId: string,
    mimeType: string,
    filename?: string
  ) => {
    signed.push({ accountId, mimeType, filename });
    return {
      uploadUrl: `https://project.supabase.co/storage/v1/object/upload/sign/chat-media/${accountId}/chat-123?token=t`,
      path: `chat-media/${accountId}/chat-123.${mimeType.split('/')[1]}`,
    };
  },
}));

import { POST } from './route';

function stage(body: unknown) {
  return POST(
    new Request('http://test/api/whatsapp/media/upload-url', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  role = 'agent';
  signed.length = 0;
});

describe('POST /api/whatsapp/media/upload-url', () => {
  it('[INB-012] signs one upload under this account and names its kind', async () => {
    const res = await stage({
      filename: 'layout.jpg',
      mime_type: 'image/jpeg',
      size: 2048,
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.media_url).toBe('chat-media/acc-1/chat-123.jpeg');
    expect(body.data.media_kind).toBe('image');
    expect(body.data.filename).toBe('layout.jpg');
    expect(body.data.upload_url).toContain('/object/upload/sign/chat-media/');
    expect(signed[0].accountId).toBe('acc-1');
  });

  it('stages a browser voice note, codec parameter and all', async () => {
    const res = await stage({
      filename: 'voice-1.ogg',
      mime_type: 'audio/ogg;codecs=opus',
      size: 4096,
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.media_kind).toBe('audio');
    // Meta is told the bare type; the codec parameter is ours, not its.
    expect(body.data.mime_type).toBe('audio/ogg');
    expect(signed[0].mimeType).toBe('audio/ogg');
  });

  it('refuses the webm an unconstrained recorder would produce', async () => {
    const res = await stage({
      filename: 'voice-1.webm',
      mime_type: 'audio/webm',
      size: 4096,
    });
    const body = await res.json();

    expect(res.status).toBe(415);
    expect(body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(signed).toHaveLength(0);
  });

  it('[INB-012] refuses an oversized file by naming the cap it broke', async () => {
    const res = await stage({
      filename: 'tour.mp4',
      mime_type: 'video/mp4',
      size: 17 * 1024 * 1024,
    });
    const body = await res.json();

    expect(res.status).toBe(415);
    expect(body.code).toBe('MEDIA_TOO_LARGE');
    expect(body.error).toContain('16 MB');
    expect(signed).toHaveLength(0);
  });

  it('[INB-012] signs a video the old byte-proxying route could never carry', async () => {
    const res = await stage({
      filename: 'walkthrough.mp4',
      mime_type: 'video/mp4',
      size: 15 * 1024 * 1024,
    });

    expect(res.status).toBe(200);
    expect(signed).toHaveLength(1);
  });

  it('rejects a request that declares no size', async () => {
    const res = await stage({
      filename: 'layout.jpg',
      mime_type: 'image/jpeg',
    });
    expect(res.status).toBe(400);
    expect(signed).toHaveLength(0);
  });

  it('gates attaching behind the same role as sending', async () => {
    role = 'viewer';
    const res = await stage({
      filename: 'layout.jpg',
      mime_type: 'image/jpeg',
      size: 2048,
    });
    expect(res.status).toBe(403);
    expect(signed).toHaveLength(0);
  });
});
