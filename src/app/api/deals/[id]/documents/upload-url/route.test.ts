import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/deals/[id]/documents/upload-url — the first half of filing
 * a document into a deal folder.
 *
 * A file the folder would refuse is refused now, before anything is
 * uploaded, and what comes back is a path under this account's own deal
 * prefix — the only shape the filing route will accept.
 */

let role: 'agent' | 'viewer' = 'agent';
let dealExists = true;
const signed: Array<{ accountId: string; dealId: string; filename?: string }> =
  [];

vi.mock('@/lib/auth/account', () => ({
  requireWriteRole: async () => {
    if (role === 'viewer') throw new Error('Requires agent role');
    return {
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: dealExists ? { id: 'deal-1' } : null,
                }),
              }),
            }),
          }),
        }),
      },
      accountId: 'acc-1',
      userId: 'user-1',
    };
  },
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 403 }
    ),
}));

vi.mock('@/lib/storage/deal-documents', () => ({
  signDealDocumentUpload: async (
    accountId: string,
    dealId: string,
    filename?: string
  ) => {
    signed.push({ accountId, dealId, filename });
    return {
      uploadUrl: `https://project.supabase.co/storage/v1/object/upload/sign/deal-documents/${accountId}/${dealId}/1-doc.pdf?token=t`,
      storagePath: `deal-documents/${accountId}/${dealId}/1-doc.pdf`,
    };
  },
}));

import { POST } from './route';

function stage(body: unknown) {
  return POST(
    new Request('http://test/api/deals/deal-1/documents/upload-url', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'deal-1' }) }
  );
}

beforeEach(() => {
  role = 'agent';
  dealExists = true;
  signed.length = 0;
});

describe('POST /api/deals/[id]/documents/upload-url', () => {
  it('[INV-008] signs one upload under this account and deal', async () => {
    const res = await stage({
      filename: 'sale-deed.pdf',
      mime_type: 'application/pdf',
      size: 2048,
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.storage_path).toBe('deal-documents/acc-1/deal-1/1-doc.pdf');
    expect(body.data.upload_url).toContain('/object/upload/sign/deal-documents/');
    expect(signed[0]).toMatchObject({ accountId: 'acc-1', dealId: 'deal-1' });
  });

  it('[INV-008] signs a scan the old byte-proxying route could never carry', async () => {
    const res = await stage({
      filename: 'survey.pdf',
      mime_type: 'application/pdf',
      size: 30 * 1024 * 1024,
    });

    expect(res.status).toBe(200);
    expect(signed).toHaveLength(1);
  });

  it('[INV-008] refuses a file over the folder limit', async () => {
    const res = await stage({
      filename: 'huge.pdf',
      mime_type: 'application/pdf',
      size: 60 * 1024 * 1024,
    });
    const body = await res.json();

    expect(res.status).toBe(413);
    expect(body.code).toBe('FILE_TOO_LARGE');
    expect(signed).toHaveLength(0);
  });

  it('[INV-008] refuses a type the folder does not take', async () => {
    const res = await stage({
      filename: 'clip.mp4',
      mime_type: 'video/mp4',
      size: 2048,
    });
    const body = await res.json();

    expect(res.status).toBe(415);
    expect(body.code).toBe('UNSUPPORTED_TYPE');
    expect(signed).toHaveLength(0);
  });

  it('refuses a deal this account does not own', async () => {
    dealExists = false;
    const res = await stage({
      filename: 'sale-deed.pdf',
      mime_type: 'application/pdf',
      size: 2048,
    });
    expect(res.status).toBe(404);
    expect(signed).toHaveLength(0);
  });

  it('gates filing behind a writing role', async () => {
    role = 'viewer';
    const res = await stage({
      filename: 'sale-deed.pdf',
      mime_type: 'application/pdf',
      size: 2048,
    });
    expect(res.status).toBe(403);
    expect(signed).toHaveLength(0);
  });
});
