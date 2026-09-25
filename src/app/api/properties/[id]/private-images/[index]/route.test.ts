import { beforeEach, describe, expect, it, vi } from 'vitest';

const state: {
  property: Record<string, unknown> | null;
  role: string;
  signed: Array<[string, number]>;
  downloads: string[];
} = { property: null, role: 'admin', signed: [], downloads: [] };

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: state.property, error: null }),
    };
    return {
      accountId: 'account-1',
      role: state.role,
      userId: 'user-1',
      supabase: { from: () => query },
    };
  },
  toErrorResponse: (error: unknown) =>
    Response.json({ error: String(error) }, { status: 500 }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async (key: string, ttl: number) => {
          state.signed.push([key, ttl]);
          return {
            data: { signedUrl: `https://cdn.test/sign/${key}` },
            error: null,
          };
        },
        download: async (key: string) => {
          state.downloads.push(key);
          return { data: new Blob(['x'], { type: 'image/jpeg' }), error: null };
        },
      }),
    },
  }),
}));

import { GET } from './route';

beforeEach(() => {
  state.role = 'admin';
  state.signed = [];
  state.downloads = [];
  state.property = {
    id: 'prop-1',
    user_id: 'user-2',
    type: 'Residential Land/ Plot',
    location_privacy: null,
    private_images: ['property-images-private/account-1/a.jpg'],
  };
});

function call(query = '') {
  return GET(
    new Request(`http://test/api/properties/prop-1/private-images/0${query}`),
    { params: Promise.resolve({ id: 'prop-1', index: '0' }) }
  );
}

describe('GET /api/properties/[id]/private-images/[index]', () => {
  it('streams the photo by default', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(state.downloads).toEqual(['account-1/a.jpg']);
    expect(state.signed).toEqual([]);
  });

  it('returns a short-lived signed link as JSON for the mobile app', async () => {
    const res = await call('?format=json');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { url: 'https://cdn.test/sign/account-1/a.jpg' },
    });
    expect(state.signed).toEqual([['account-1/a.jpg', 600]]);
    expect(state.downloads).toEqual([]);
  });

  it('signs nothing for an index past the guarded list', async () => {
    const res = await GET(
      new Request(
        'http://test/api/properties/prop-1/private-images/3?format=json'
      ),
      { params: Promise.resolve({ id: 'prop-1', index: '3' }) }
    );
    expect(res.status).toBe(404);
    expect(state.signed).toEqual([]);
  });
});
