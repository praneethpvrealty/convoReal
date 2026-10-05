import { beforeEach, describe, expect, it, vi } from 'vitest';

let readOnly: boolean;
let stored: Blob | null;
let removed: string[][];
let uploads: { accountId: string; bytes: number; mimeType: string }[];

vi.mock('@/lib/auth/account', () => ({
  requireWriteRole: async () => {
    if (readOnly) {
      throw Object.assign(new Error('Read-only'), { status: 403 });
    }
    return { accountId: 'acc-1', userId: 'user-1' };
  },
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: (err as { status?: number })?.status ?? 500 }
    ),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    storage: {
      from: () => ({
        download: async () =>
          stored
            ? { data: stored, error: null }
            : { data: null, error: new Error('not found') },
        remove: async (paths: string[]) => {
          removed.push(paths);
          return { error: null };
        },
      }),
    },
  }),
}));

vi.mock('@/lib/storage/upload', () => ({
  uploadPropertyImage: vi.fn(
    async (accountId: string, buffer: Buffer, mimeType: string) => {
      uploads.push({ accountId, bytes: buffer.length, mimeType });
      return `property-images/${accountId}/img-resized.jpg`;
    }
  ),
}));

const { POST } = await import('./route');

function request(path: unknown) {
  return new Request('http://localhost/api/properties/images', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

beforeEach(() => {
  readOnly = false;
  stored = new Blob([new Uint8Array(4)], { type: 'image/jpeg' });
  removed = [];
  uploads = [];
});

describe('POST /api/properties/images', () => {
  it('resizes the uploaded original through the shared pipeline and removes it', async () => {
    const res = await POST(request('property-images/acc-1/img-raw.jpg'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { path: 'property-images/acc-1/img-resized.jpg' },
    });
    expect(uploads).toEqual([
      { accountId: 'acc-1', bytes: 4, mimeType: 'image/jpeg' },
    ]);
    expect(removed).toEqual([['acc-1/img-raw.jpg']]);
  });

  it("refuses a path outside the caller's account folder", async () => {
    for (const path of [
      'property-images/acc-2/img.jpg',
      'property-images/acc-1/../acc-2/img.jpg',
      'property-documents/acc-1/img.jpg',
      42,
    ]) {
      const res = await POST(request(path));
      expect(res.status).toBe(400);
    }
    expect(uploads).toEqual([]);
    expect(removed).toEqual([]);
  });

  it('refuses a read-only member', async () => {
    readOnly = true;
    const res = await POST(request('property-images/acc-1/img-raw.jpg'));
    expect(res.status).toBe(403);
    expect(removed).toEqual([]);
  });

  it('removes a non-image original without storing it', async () => {
    stored = new Blob(['%PDF'], { type: 'application/pdf' });
    const res = await POST(request('property-images/acc-1/doc.jpg'));
    expect(res.status).toBe(415);
    expect(uploads).toEqual([]);
    expect(removed).toEqual([['acc-1/doc.jpg']]);
  });

  it('reports a missing original', async () => {
    stored = null;
    const res = await POST(request('property-images/acc-1/gone.jpg'));
    expect(res.status).toBe(404);
  });
});
