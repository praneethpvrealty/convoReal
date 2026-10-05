import { beforeEach, describe, expect, it, vi } from 'vitest';

let readOnly: boolean;
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

vi.mock('@/lib/storage/upload', () => ({
  uploadPropertyImage: vi.fn(
    async (accountId: string, buffer: Buffer, mimeType: string) => {
      uploads.push({ accountId, bytes: buffer.length, mimeType });
      return `property-images/${accountId}/img-${uploads.length}.jpg`;
    }
  ),
}));

const { POST } = await import('./route');

function request(files: File[]) {
  const form = new FormData();
  for (const file of files) form.append('files', file);
  return new Request('http://localhost/api/properties/images', {
    method: 'POST',
    body: form,
  });
}

function photo(name = 'a.jpg', type = 'image/jpeg', bytes = 4) {
  return new File([new Uint8Array(bytes)], name, { type });
}

beforeEach(() => {
  readOnly = false;
  uploads = [];
});

describe('POST /api/properties/images', () => {
  it("stores each photo through the shared resize pipeline under the caller's account", async () => {
    const res = await POST(
      request([photo('a.jpg'), photo('b.png', 'image/png')])
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        paths: [
          'property-images/acc-1/img-1.jpg',
          'property-images/acc-1/img-2.jpg',
        ],
      },
    });
    expect(uploads).toEqual([
      { accountId: 'acc-1', bytes: 4, mimeType: 'image/jpeg' },
      { accountId: 'acc-1', bytes: 4, mimeType: 'image/png' },
    ]);
  });

  it('refuses a read-only member', async () => {
    readOnly = true;
    const res = await POST(request([photo()]));
    expect(res.status).toBe(403);
    expect(uploads).toEqual([]);
  });

  it('refuses a non-image before uploading anything', async () => {
    const res = await POST(
      request([photo(), photo('notes.pdf', 'application/pdf')])
    );
    expect(res.status).toBe(415);
    expect(uploads).toEqual([]);
  });

  it('refuses an empty form', async () => {
    const res = await POST(request([]));
    expect(res.status).toBe(400);
  });
});
