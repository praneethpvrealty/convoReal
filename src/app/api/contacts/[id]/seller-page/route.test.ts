import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isSellerPageSlug } from '@/lib/showcase/seller-page';

type Row = Record<string, unknown>;

let tables: Record<string, Row[]>;
let uniqueViolations: number;
let role: 'agent' | 'viewer';

function makeDb() {
  return {
    from(table: string) {
      const filters: Array<[string, unknown, 'eq' | 'neq']> = [];
      let patch: Row | null = null;
      const matches = () =>
        (tables[table] ?? []).filter((row) =>
          filters.every(([column, value, op]) =>
            op === 'eq' ? row[column] === value : row[column] !== value
          )
        );
      const run = () => {
        if (patch) {
          if (
            'seller_page_slug' in patch &&
            patch.seller_page_slug !== null &&
            uniqueViolations > 0
          ) {
            uniqueViolations -= 1;
            return { data: null, error: { code: '23505', message: 'dup' } };
          }
          for (const row of matches()) Object.assign(row, patch);
          return { data: null, error: null };
        }
        return { data: matches(), error: null };
      };
      const builder: Record<string, unknown> = {
        select: () => builder,
        update: (values: Row) => {
          patch = values;
          return builder;
        },
        eq: (column: string, value: unknown) => {
          filters.push([column, value, 'eq']);
          return builder;
        },
        neq: (column: string, value: unknown) => {
          filters.push([column, value, 'neq']);
          return builder;
        },
        maybeSingle: () =>
          Promise.resolve({ data: matches()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(run()).then(resolve),
      };
      return builder;
    },
  };
}

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  const context = () => {
    if (role === 'viewer') throw new actual.ForbiddenError();
    return { supabase: makeDb(), accountId: 'acc-1', userId: 'user-1' };
  };
  return {
    ...actual,
    requireRole: async () => context(),
    requireWriteRole: async () => context(),
  };
});

vi.mock('@/lib/showcase/account-showcase-url', () => ({
  accountShowcaseOrigin: async () => 'https://acme.convoreal.com',
  accountBrandName: async () => 'Acme Realty',
}));

const { GET, POST, DELETE } = await import('./route');

const params = (id = 'seller-1') => ({ params: Promise.resolve({ id }) });
const request = (body?: unknown) =>
  new Request('http://localhost/api/contacts/seller-1/seller-page', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;

async function dataOf(response: Response) {
  return ((await response.json()) as { data: Record<string, unknown> }).data;
}

beforeEach(() => {
  role = 'agent';
  uniqueViolations = 0;
  tables = {
    contacts: [
      { id: 'seller-1', account_id: 'acc-1', seller_page_slug: null },
      { id: 'foreign', account_id: 'acc-2', seller_page_slug: null },
    ],
    properties: [
      {
        account_id: 'acc-1',
        owner_contact_id: 'seller-1',
        listing_source: 'owner',
        is_published: true,
      },
      {
        account_id: 'acc-1',
        owner_contact_id: 'seller-1',
        listing_source: 'owner',
        is_published: false,
      },
      {
        account_id: 'acc-1',
        owner_contact_id: 'seller-1',
        listing_source: 'agent',
        is_published: true,
      },
    ],
  };
});

describe('seller page agency API', () => {
  it('reports an unenabled page with the seller’s live listing count', async () => {
    const data = await dataOf(await GET(request(), params()));
    expect(data).toEqual({
      enabled: false,
      url: null,
      listing_count: 1,
      owns_listings: true,
      share_message: null,
    });
  });

  it('enables a page on the agency showcase origin', async () => {
    const data = await dataOf(await POST(request({}), params()));
    expect(data.enabled).toBe(true);
    const slug = String(data.url).replace(
      'https://acme.convoreal.com/seller/',
      ''
    );
    expect(isSellerPageSlug(slug)).toBe(true);
    expect(data.share_message).toContain('Acme Realty');
    expect(String(data.share_message).endsWith(String(data.url))).toBe(true);
  });

  it('keeps the existing link when enabling again without rotate', async () => {
    const first = await dataOf(await POST(request({}), params()));
    const second = await dataOf(await POST(request({}), params()));
    expect(second.url).toBe(first.url);
  });

  it('[SLP-003] replaces the link on rotate and clears it on turn off', async () => {
    const first = await dataOf(await POST(request({}), params()));
    const rotated = await dataOf(
      await POST(request({ rotate: true }), params())
    );
    expect(rotated.url).not.toBe(first.url);
    const off = await dataOf(await DELETE(request(), params()));
    expect(off).toMatchObject({ enabled: false, url: null });
    expect(tables.contacts[0].seller_page_slug).toBeNull();
  });

  it('retries when a generated slug collides', async () => {
    uniqueViolations = 2;
    const data = await dataOf(await POST(request({}), params()));
    expect(data.enabled).toBe(true);
  });

  it('returns 404 for a contact in another account', async () => {
    const response = await POST(request({}), params('foreign'));
    expect(response.status).toBe(404);
    expect(tables.contacts[1].seller_page_slug).toBeNull();
  });

  it('[SLP-006] refuses members below the agent role', async () => {
    role = 'viewer';
    for (const response of [
      await GET(request(), params()),
      await POST(request({}), params()),
      await DELETE(request(), params()),
    ]) {
      expect(response.status).toBe(403);
    }
    expect(tables.contacts[0].seller_page_slug).toBeNull();
  });
});
