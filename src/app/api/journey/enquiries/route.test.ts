import { beforeEach, describe, expect, it, vi } from 'vitest';

const SUBJECT = '11111111-2222-4333-8444-555555555555';

let filters: [string, unknown][];
let rows: unknown[];
let failRole: boolean;

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => {
    if (failRole) {
      throw Object.assign(new Error('Not signed in'), { status: 401 });
    }
    const builder: Record<string, (...args: unknown[]) => unknown> = {
      select: () => builder,
      eq: (column: unknown, value: unknown) => {
        filters.push([String(column), value]);
        return builder;
      },
      then: (resolve: unknown, reject: unknown) =>
        Promise.resolve({ data: rows, error: null }).then(
          resolve as (v: unknown) => unknown,
          reject as (v: unknown) => unknown
        ),
    };
    return {
      supabase: { from: () => builder },
      accountId: 'acc-1',
      userId: 'user-1',
    };
  },
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: (err as Error).message },
      { status: (err as { status?: number }).status ?? 500 }
    ),
}));

const { GET } = await import('./route');

function get(query: string) {
  return GET(new Request(`http://localhost/api/journey/enquiries?${query}`));
}

describe('GET /api/journey/enquiries', () => {
  beforeEach(() => {
    filters = [];
    failRole = false;
    rows = [
      {
        id: 'old',
        inquiry_source: 'Housing',
        inquiry_date: '2026-01-02T00:00:00Z',
        created_at: '2026-03-01T00:00:00Z',
        property: {
          id: 'p1',
          title: 'Villa 12',
          property_code: 'PROP-12',
          location: 'Whitefield',
        },
        contact: { id: 'c1', name: 'Supreeth', phone: '+917022217893' },
      },
      {
        id: 'new',
        inquiry_source: null,
        inquiry_date: '2026-02-01T00:00:00Z',
        created_at: null,
        property: null,
        contact: null,
      },
    ];
  });

  it('[JRN-012] lists a buyer journey’s enquired properties newest first, scoped to the account', async () => {
    const res = await get(`mode=buyer&subjectId=${SUBJECT}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((entry: { id: string }) => entry.id)).toEqual([
      'new',
      'old',
    ]);
    expect(body.data[1]).toMatchObject({
      targetId: 'p1',
      title: 'Villa 12',
      subtitle: 'PROP-12 · Whitefield',
    });
    expect(filters).toEqual([
      ['account_id', 'acc-1'],
      ['contact_id', SUBJECT],
    ]);
  });

  it('[JRN-012] filters a property journey by the listing', async () => {
    const res = await get(`mode=property&subjectId=${SUBJECT}`);
    const body = await res.json();
    expect(filters).toContainEqual(['property_id', SUBJECT]);
    expect(body.data[1]).toMatchObject({ targetId: 'c1', title: 'Supreeth' });
  });

  it('rejects an unknown mode or a malformed subject', async () => {
    expect((await get(`mode=deal&subjectId=${SUBJECT}`)).status).toBe(400);
    expect((await get('mode=buyer&subjectId=x')).status).toBe(400);
    expect(filters).toEqual([]);
  });

  it('refuses callers without an account session', async () => {
    failRole = true;
    expect((await get(`mode=buyer&subjectId=${SUBJECT}`)).status).toBe(401);
  });
});
