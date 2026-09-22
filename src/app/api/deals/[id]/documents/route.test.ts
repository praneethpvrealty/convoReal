import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/deals/[id]/documents — the second half of filing a document.
 *
 * The bytes no longer travel through this route, so it is the only
 * place left that can tell whether the object a caller names is theirs,
 * exists, and is what it claimed to be. The row's size and type are
 * read back from storage rather than taken from the request: they are
 * what the folder shows an agent and what the extractor later reads.
 */

let staged: { size: number; mimeType: string } | null;
let inserted: Record<string, unknown> | null;
let insertFails = false;
const removed: string[][] = [];

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({}),
  requireWriteRole: async () => ({
    supabase: {
      from: (table: string) => {
        if (table === 'deals') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { id: 'deal-1' } }),
                }),
              }),
            }),
          };
        }
        return {
          insert: (row: Record<string, unknown>) => {
            inserted = row;
            return {
              select: () => ({
                single: async () =>
                  insertFails
                    ? { data: null, error: { message: 'insert blew up' } }
                    : { data: { id: 'doc-1', ...row }, error: null },
              }),
            };
          },
        };
      },
    },
    accountId: 'acc-1',
    userId: 'user-1',
  }),
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 403 }
    ),
}));

vi.mock('@/lib/storage/deal-documents', () => ({
  dealDocumentObjectPath: (a: string, d: string, n: string) =>
    `${a}/${d}/1-${n}`,
  stagedDealDocument: async () => staged,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async (paths: string[]) => {
          removed.push(paths);
          return { error: null };
        },
      }),
    },
  }),
}));

vi.mock('@/lib/deals/events', () => ({
  parseEventSource: (v: unknown) => (v === 'mobile' ? 'mobile' : 'web'),
  writeDealEvent: async () => undefined,
}));

vi.mock('@/lib/deals/server', () => ({ actorName: async () => 'Agent' }));

import { POST } from './route';

function file(body: unknown) {
  return POST(
    new Request('http://test/api/deals/deal-1/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'deal-1' }) }
  );
}

const path = 'deal-documents/acc-1/deal-1/1-deed.pdf';

beforeEach(() => {
  staged = { size: 2048, mimeType: 'application/pdf' };
  inserted = null;
  insertFails = false;
  removed.length = 0;
});

describe('POST /api/deals/[id]/documents', () => {
  it('[INV-008] files a staged upload with the size storage actually holds', async () => {
    staged = { size: 4096, mimeType: 'application/pdf' };

    const res = await file({
      storage_path: path,
      category: 'agreement',
      title: 'Sale deed',
      // A client claiming otherwise must not decide what the row says.
      size: 1,
      mime_type: 'text/plain',
    });

    expect(res.status).toBe(201);
    expect(inserted).toMatchObject({
      account_id: 'acc-1',
      deal_id: 'deal-1',
      storage_path: path,
      mime_type: 'application/pdf',
      size_bytes: 4096,
      title: 'Sale deed',
      category: 'agreement',
    });
  });

  it("[INV-008] refuses another account's path", async () => {
    const res = await file({
      storage_path: 'deal-documents/acc-2/deal-1/1-deed.pdf',
      category: 'agreement',
    });
    expect(res.status).toBe(400);
    expect(inserted).toBeNull();
  });

  it('[INV-008] refuses another deal in the same account', async () => {
    const res = await file({
      storage_path: 'deal-documents/acc-1/deal-9/1-deed.pdf',
      category: 'agreement',
    });
    expect(res.status).toBe(400);
    expect(inserted).toBeNull();
  });

  it('[INV-008] refuses a path nothing was uploaded to', async () => {
    staged = null;
    const res = await file({ storage_path: path, category: 'agreement' });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('did not finish');
    expect(inserted).toBeNull();
  });

  it('[INV-008] refuses a file that landed over the limit, and clears it', async () => {
    staged = { size: 60 * 1024 * 1024, mimeType: 'application/pdf' };
    const res = await file({ storage_path: path, category: 'agreement' });
    const body = await res.json();

    expect(res.status).toBe(413);
    expect(body.code).toBe('FILE_TOO_LARGE');
    expect(inserted).toBeNull();
    expect(removed[0]).toEqual(['acc-1/deal-1/1-deed.pdf']);
  });

  it('[INV-008] refuses a type the folder does not take, and clears it', async () => {
    staged = { size: 2048, mimeType: 'video/mp4' };
    const res = await file({ storage_path: path, category: 'agreement' });
    const body = await res.json();

    expect(res.status).toBe(415);
    expect(body.code).toBe('UNSUPPORTED_TYPE');
    expect(inserted).toBeNull();
    expect(removed[0]).toEqual(['acc-1/deal-1/1-deed.pdf']);
  });

  it('refuses an unknown category', async () => {
    const res = await file({ storage_path: path, category: 'nonsense' });
    expect(res.status).toBe(400);
    expect(inserted).toBeNull();
  });

  it('leaves no orphan object when the row cannot be written', async () => {
    insertFails = true;
    const res = await file({ storage_path: path, category: 'agreement' });

    expect(res.status).toBe(400);
    expect(removed[0]).toEqual(['acc-1/deal-1/1-deed.pdf']);
  });

  it('still takes the multipart body clients shipped before the signed upload', async () => {
    const form = new FormData();
    form.append(
      'file',
      new File([new Uint8Array(1024)], 'deed.pdf', {
        type: 'application/pdf',
      })
    );
    form.append('category', 'agreement');

    const res = await POST(
      new Request('http://test/api/deals/deal-1/documents', {
        method: 'POST',
        body: form,
      }),
      { params: Promise.resolve({ id: 'deal-1' }) }
    );

    expect(res.status).toBe(201);
    expect(inserted).toMatchObject({
      mime_type: 'application/pdf',
      size_bytes: 1024,
    });
  });
});
