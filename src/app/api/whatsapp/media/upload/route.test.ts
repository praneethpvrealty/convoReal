import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/whatsapp/media/upload — the first half of sending an
 * attachment or a voice note.
 *
 * What matters here is that a file Meta would refuse is refused now,
 * while the agent is still looking at the picker, and that what comes
 * back is exactly the shape /api/whatsapp/send will take: a path inside
 * this account's own prefix, plus the kind the dispatcher switches on.
 */

let role: 'agent' | 'viewer' = 'agent';
const uploaded: Array<{
  accountId: string;
  mimeType: string;
  filename?: string;
  bytes: number;
}> = [];

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => {
    if (role === 'viewer') throw new Error('Requires agent role');
    return { supabase: {}, accountId: 'acc-1', userId: 'user-1' };
  },
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 403 },
    ),
}));

vi.mock('@/lib/storage/upload', () => ({
  uploadChatMedia: async (
    accountId: string,
    buffer: Buffer,
    mimeType: string,
    filename?: string,
  ) => {
    uploaded.push({ accountId, mimeType, filename, bytes: buffer.length });
    return `chat-media/${accountId}/chat-123.${mimeType.split('/')[1]}`;
  },
}));

import { POST } from './route';

function upload(file: File) {
  const form = new FormData();
  form.append('file', file);
  return POST(
    new Request('http://test/api/whatsapp/media/upload', {
      method: 'POST',
      body: form,
    }),
  );
}

function fileOf(name: string, type: string, bytes: number) {
  return new File([new Uint8Array(bytes)], name, { type });
}

beforeEach(() => {
  role = 'agent';
  uploaded.length = 0;
});

describe('POST /api/whatsapp/media/upload', () => {
  it('stages a photo under this account and names its kind', async () => {
    const res = await upload(fileOf('layout.jpg', 'image/jpeg', 2048));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.media_url).toBe('chat-media/acc-1/chat-123.jpeg');
    expect(body.data.media_kind).toBe('image');
    expect(body.data.filename).toBe('layout.jpg');
    expect(uploaded[0].accountId).toBe('acc-1');
  });

  it('stages a browser voice note, codec parameter and all', async () => {
    const res = await upload(
      fileOf('voice-1.ogg', 'audio/ogg;codecs=opus', 4096),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.media_kind).toBe('audio');
    // Meta is told the bare type; the codec parameter is ours, not its.
    expect(uploaded[0].mimeType).toBe('audio/ogg');
  });

  it('refuses the webm an unconstrained recorder would produce', async () => {
    const res = await upload(fileOf('voice-1.webm', 'audio/webm', 4096));
    const body = await res.json();

    expect(res.status).toBe(415);
    expect(body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(uploaded).toHaveLength(0);
  });

  it('refuses an oversized file by naming the cap it broke', async () => {
    const res = await upload(
      fileOf('tour.mp4', 'video/mp4', 17 * 1024 * 1024),
    );
    const body = await res.json();

    expect(res.status).toBe(415);
    expect(body.code).toBe('MEDIA_TOO_LARGE');
    expect(body.error).toContain('16 MB');
    expect(uploaded).toHaveLength(0);
  });

  it('rejects a request with no file', async () => {
    const res = await POST(
      new Request('http://test/api/whatsapp/media/upload', {
        method: 'POST',
        body: new FormData(),
      }),
    );
    expect(res.status).toBe(400);
    expect(uploaded).toHaveLength(0);
  });

  it('gates attaching behind the same role as sending', async () => {
    role = 'viewer';
    const res = await upload(fileOf('layout.jpg', 'image/jpeg', 2048));
    expect(res.status).toBe(403);
    expect(uploaded).toHaveLength(0);
  });
});
