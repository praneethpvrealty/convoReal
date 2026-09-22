import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The gate a media send passes through.
 *
 * The bytes no longer travel through the app, so the send route is the
 * only place left that can tell whether the object a caller names
 * exists and is what it claimed to be. Meta fetches this link
 * server-side: a path outside the account, a path nothing was ever
 * written to, or a file that grew past the cap the staging route
 * approved all have to die here.
 */

let staged: { size: number; mimeType: string } | null = null;

vi.mock('@/lib/storage/chat-media', () => ({
  CHAT_MEDIA_BUCKET: 'chat-media',
  stagedChatMedia: async () => staged,
}));

import { refuseStagedMedia } from './staged-media';

beforeEach(() => {
  staged = { size: 2048, mimeType: 'image/jpeg' };
});

describe('refuseStagedMedia', () => {
  it('[INB-012] passes an attachment staged by this account', async () => {
    expect(
      await refuseStagedMedia('acc-1', 'chat-media/acc-1/chat-1.jpeg')
    ).toBeNull();
  });

  it("[INB-012] refuses another account's path", async () => {
    const refusal = await refuseStagedMedia(
      'acc-1',
      'chat-media/acc-2/chat-1.jpeg'
    );
    expect(refusal?.status).toBe(400);
    expect(refusal?.error).toContain('staged by this account');
  });

  it('refuses a URL Meta would fetch from somewhere else', async () => {
    const refusal = await refuseStagedMedia(
      'acc-1',
      'https://example.com/payload.jpeg'
    );
    expect(refusal?.status).toBe(400);
  });

  it('[INB-012] refuses a path nothing was uploaded to', async () => {
    staged = null;
    const refusal = await refuseStagedMedia(
      'acc-1',
      'chat-media/acc-1/chat-1.jpeg'
    );
    expect(refusal?.status).toBe(400);
    expect(refusal?.error).toContain('did not finish uploading');
  });

  it('[INB-012] refuses a file that landed bigger than the cap it was signed for', async () => {
    staged = { size: 40 * 1024 * 1024, mimeType: 'video/mp4' };
    const refusal = await refuseStagedMedia(
      'acc-1',
      'chat-media/acc-1/chat-1.mp4'
    );
    expect(refusal?.status).toBe(415);
    expect(refusal?.code).toBe('MEDIA_TOO_LARGE');
    expect(refusal?.error).toContain('16 MB');
  });

  it('refuses a type WhatsApp will not take, whatever was declared', async () => {
    staged = { size: 2048, mimeType: 'application/x-msdownload' };
    const refusal = await refuseStagedMedia(
      'acc-1',
      'chat-media/acc-1/chat-1.bin'
    );
    expect(refusal?.status).toBe(415);
    expect(refusal?.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });
});
