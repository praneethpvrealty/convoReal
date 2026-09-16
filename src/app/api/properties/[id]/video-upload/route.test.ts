import { beforeEach, describe, expect, it, vi } from 'vitest';

let role: 'agent' | 'viewer' = 'agent';
let plan: 'starter' | 'solo_pro' = 'starter';
let property: {
  id: string;
  video_url: string | null;
  video_status: string | null;
  youtube_status: string | null;
} | null;
let readCount = 0;
const updates: Record<string, unknown>[] = [];
const uploaded: Array<{ accountId: string; mimeType: string; bytes: number }> =
  [];
const removed: string[][] = [];
const queued: Array<{ propertyId: string; accountId: string }> = [];

const videoState = {
  video_url: 'property-videos/acc-1/wa-new.mp4',
  video_status: 'ready',
  video_language: null,
  video_error: null,
  video_generated_at: null,
  youtube_video_id: null,
  youtube_status: null,
  youtube_error: null,
  youtube_uploaded_at: null,
};

function query() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    update: (value: Record<string, unknown>) => {
      updates.push(value);
      return chain;
    },
    maybeSingle: async () => {
      readCount += 1;
      return { data: readCount === 1 ? property : videoState, error: null };
    },
  };
  return chain;
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => {
    if (role === 'viewer') throw new Error('Requires agent role');
    return {
      accountId: 'acc-1',
      userId: 'user-1',
      supabase: { from: () => query() },
    };
  },
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 403 }
    ),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ success: true }),
  rateLimitResponse: () => Response.json({ error: 'rate' }, { status: 429 }),
}));

vi.mock('@/lib/billing/gates', () => ({
  getPlanLimits: async () => ({ plan }),
}));

vi.mock('@/lib/storage/upload', () => ({
  uploadPropertyVideo: async (
    accountId: string,
    buffer: Buffer,
    mimeType: string
  ) => {
    uploaded.push({ accountId, mimeType, bytes: buffer.length });
    return videoState.video_url;
  },
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    storage: {
      from: () => ({
        createSignedUploadUrl: async () => ({
          data: { token: 'signed-token' },
          error: null,
        }),
        list: async () => ({ data: [], error: null }),
        remove: async (paths: string[]) => {
          removed.push(paths);
          return { error: null };
        },
      }),
    },
  }),
}));

vi.mock('@/lib/youtube/upload', () => ({
  queueYouTubeUploadIfConnected: async (
    propertyId: string,
    accountId: string
  ) => {
    queued.push({ propertyId, accountId });
  },
}));

import { POST, PUT } from './route';

function fileOf(type: string, bytes: number) {
  return new File([new Uint8Array(bytes)], 'walkthrough.mp4', { type });
}

function upload(file?: File) {
  const form = new FormData();
  if (file) form.append('file', file);
  return POST(
    new Request('http://test/api/properties/p-1/video-upload', {
      method: 'POST',
      body: form,
    }),
    { params: Promise.resolve({ id: 'p-1' }) }
  );
}

function startUpload(size: number, mimeType = 'video/mp4') {
  return PUT(
    new Request('http://test/api/properties/p-1/video-upload', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ size, mimeType }),
    }),
    { params: Promise.resolve({ id: 'p-1' }) }
  );
}

beforeEach(() => {
  role = 'agent';
  plan = 'starter';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project-ref.supabase.co';
  property = {
    id: 'p-1',
    video_url: 'property-videos/acc-1/wa-old.mp4',
    video_status: 'ready',
    youtube_status: null,
  };
  readCount = 0;
  updates.length = 0;
  uploaded.length = 0;
  removed.length = 0;
  queued.length = 0;
});

describe('[MED-001] /api/properties/[id]/video-upload', () => {
  it('replaces the listing video and reuses the YouTube auto-upload queue', async () => {
    const response = await upload(fileOf('video/mp4', 2048));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject(videoState);
    expect(uploaded).toEqual([
      { accountId: 'acc-1', mimeType: 'video/mp4', bytes: 2048 },
    ]);
    expect(updates[0]).toMatchObject({
      video_url: videoState.video_url,
      video_status: 'ready',
      video_generated_at: null,
      youtube_video_id: null,
      youtube_status: null,
    });
    expect(removed).toContainEqual(['acc-1/wa-old.mp4']);
    expect(queued).toEqual([{ propertyId: 'p-1', accountId: 'acc-1' }]);
  });

  it('rejects non-MP4 videos before storing them', async () => {
    const response = await upload(fileOf('video/quicktime', 2048));
    expect(response.status).toBe(415);
    expect((await response.json()).code).toBe('UNSUPPORTED_VIDEO_TYPE');
    expect(uploaded).toHaveLength(0);
  });

  it('rejects Starter videos over 16 MB', async () => {
    const response = await upload(fileOf('video/mp4', 16 * 1024 * 1024 + 1));
    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe('VIDEO_TOO_LARGE');
    expect(uploaded).toHaveLength(0);
  });

  it('creates a resumable 100 MB upload session for a paid plan', async () => {
    plan = 'solo_pro';
    const response = await startUpload(100 * 1024 * 1024);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      endpoint:
        'https://project-ref.storage.supabase.co/storage/v1/upload/resumable',
      token: 'signed-token',
      maxBytes: 100 * 1024 * 1024,
    });
    expect(body.data.path).toMatch(/^acc-1\/wa-.+\.mp4$/);
  });

  it('keeps resumable Starter uploads at 16 MB', async () => {
    const response = await startUpload(16 * 1024 * 1024 + 1);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      code: 'VIDEO_TOO_LARGE',
      maxMegabytes: 16,
      plan: 'starter',
    });
  });

  it('gates uploads to agents and above', async () => {
    role = 'viewer';
    const response = await upload(fileOf('video/mp4', 2048));
    expect(response.status).toBe(403);
    expect(uploaded).toHaveLength(0);
  });

  it('does not replace a video while its YouTube upload is in flight', async () => {
    property!.youtube_status = 'uploading';
    const response = await upload(fileOf('video/mp4', 2048));
    expect(response.status).toBe(409);
    expect(uploaded).toHaveLength(0);
  });
});
