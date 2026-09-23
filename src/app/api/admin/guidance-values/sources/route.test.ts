import { beforeEach, describe, expect, it, vi } from 'vitest';

const inserted: Record<string, unknown>[] = [];

vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: (err: unknown) =>
    Response.json({ error: String(err) }, { status: 403 }),
}));

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { adminAction: {} },
  checkRateLimit: async () => ({ success: true }),
  rateLimitResponse: () => Response.json({}, { status: 429 }),
}));

vi.mock('@/lib/guidance-value/server', () => ({
  GUIDANCE_SOURCE_BUCKET: 'guidance-value-sources',
  SOURCE_COLUMNS: '*',
  requireGuidanceAdmin: async () => ({ userId: 'admin-1' }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    storage: {
      from: () => ({
        createSignedUploadUrl: async (path: string) => ({
          data: { signedUrl: `https://storage.test/${path}?token=t` },
          error: null,
        }),
      }),
    },
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.insert = (row: Record<string, unknown>) => {
        inserted.push(row);
        return builder;
      };
      builder.select = () => builder;
      builder.single = async () => ({
        data: { id: 'src-1', ...inserted.at(-1) },
        error: null,
      });
      return builder;
    },
  }),
}));

import { POST } from './route';

function register(body: Record<string, unknown>) {
  return POST(
    new Request('http://test/api/admin/guidance-values/sources', {
      method: 'POST',
      body: JSON.stringify({
        district: 'Bengaluru Urban',
        title: 'Jayanagar · BTM Layout',
        mime_type: 'application/pdf',
        size: 1000,
        filename: 'btm.pdf',
        ...body,
      }),
    })
  );
}

beforeEach(() => {
  inserted.length = 0;
});

describe('POST /api/admin/guidance-values/sources', () => {
  it('[GVL-007] records where an extension-uploaded PDF came from', async () => {
    const res = await register({
      source_url: 'https://igr.karnataka.gov.in/storage/btm.pdf',
    });
    expect(res.status).toBe(201);
    expect(inserted[0]).toMatchObject({
      source_url: 'https://igr.karnataka.gov.in/storage/btm.pdf',
      uploaded_by: 'admin-1',
    });
    const { data } = await res.json();
    expect(data.upload_url).toMatch(/^https:\/\/storage\.test\/KA\//);
  });

  it('[GVL-007] refuses a source_url off karnataka.gov.in', async () => {
    const res = await register({ source_url: 'https://evil.example/x.pdf' });
    expect(res.status).toBe(400);
    expect(inserted).toHaveLength(0);
  });

  it('leaves source_url empty for a manual upload', async () => {
    const res = await register({});
    expect(res.status).toBe(201);
    expect(inserted[0].source_url).toBeNull();
  });
});
