import { beforeEach, describe, expect, it, vi } from 'vitest';

const uploads: string[] = [];
const inserted: Record<string, unknown>[] = [];
let fetched: string[] = [];

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
        upload: async (path: string) => {
          uploads.push(path);
          return { error: null };
        },
        remove: async () => ({ error: null }),
      }),
    },
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.in = async () => ({
        data: [{ source_url: 'https://igr.karnataka.gov.in/a.pdf' }],
      });
      builder.insert = (row: Record<string, unknown>) => {
        inserted.push(row);
        return builder;
      };
      builder.single = async () => ({
        data: { id: 'src-1', ...inserted.at(-1) },
        error: null,
      });
      return builder;
    },
  }),
}));

import { POST } from './route';

function call(body: unknown) {
  return POST(
    new Request('http://test/api/admin/guidance-values/import', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  uploads.length = 0;
  inserted.length = 0;
  fetched = [];
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    if (url.endsWith('.pdf')) return new Response('%PDF-1.7');
    return new Response(
      '<table><tr><td>1</td><td>Mysore</td><td>Mysuru North</td><td><a href="/a.pdf">View</a></td><td></td></tr><tr><td>2</td><td>Hunsur</td><td><a href="/b.pdf">View</a></td><td></td></tr></table>',
      { headers: { 'content-type': 'text/html' } }
    );
  });
});

describe('POST /api/admin/guidance-values/import', () => {
  it('[GVL-005] never fetches a host outside karnataka.gov.in', async () => {
    const res = await call({
      action: 'discover',
      url: 'https://169.254.169.254/latest',
    });
    expect(res.status).toBe(400);
    expect(fetched).toHaveLength(0);
  });

  it('lists the PDFs on the page and marks ones already imported', async () => {
    const res = await call({ action: 'discover' });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(
      data.map((d: { sro: string; imported: boolean }) => [d.sro, d.imported])
    ).toEqual([
      ['Mysuru North', true],
      ['Hunsur', false],
    ]);
  });

  it('[GVL-005] downloads a PDF into storage and registers its source url', async () => {
    const res = await call({
      action: 'import',
      url: 'https://igr.karnataka.gov.in/b.pdf',
      district: 'Mysuru',
      title: 'Mysore · Hunsur',
    });
    expect(res.status).toBe(201);
    expect(uploads[0]).toMatch(/^KA\/\d+-b\.pdf$/);
    expect(inserted[0]).toMatchObject({
      district: 'Mysuru',
      source_url: 'https://igr.karnataka.gov.in/b.pdf',
      uploaded_by: 'admin-1',
    });
  });

  it('requires a district and title to import', async () => {
    const res = await call({
      action: 'import',
      url: 'https://igr.karnataka.gov.in/b.pdf',
    });
    expect(res.status).toBe(400);
    expect(uploads).toHaveLength(0);
  });
});
