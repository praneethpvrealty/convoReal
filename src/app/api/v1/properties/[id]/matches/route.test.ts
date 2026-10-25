import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { table: string; op: string; args: unknown[] };
const calls: Call[] = [];
let rows: Record<string, unknown>;

function table(name: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = {};
  for (const op of ['select', 'eq', 'in', 'order', 'limit']) {
    query[op] = (...args: unknown[]) => {
      calls.push({ table: name, op, args });
      return query;
    };
  }
  query.maybeSingle = () => Promise.resolve({ data: rows[name], error: null });
  query.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: rows[name] ?? [], error: null }).then(resolve);
  return query;
}

const ctx = { db: { from: table }, accountId: 'acc-1' };

vi.mock('@/lib/auth/api-keys', () => ({
  withApiKeyAuth:
    (
      _scope: string,
      handler: (c: unknown, r: Request, rc: unknown) => Promise<Response>
    ) =>
    (req: Request, routeCtx: unknown) =>
      handler(ctx, req, routeCtx),
}));
vi.mock('@/lib/contacts/inquired-intent', () => ({
  attachInquiredListingTypes: async (_db: unknown, _a: string, c: unknown) => c,
}));

const { GET } = await import('./route');

const PROPERTY = 'p-1';
const building = {
  id: PROPERTY,
  title: 'Commercial Building',
  type: 'Commercial Building',
  listing_type: 'Sale',
  price: 150_000_000,
  city: 'Bengaluru',
};
const buyer = (id: string, name: string) => ({
  id,
  name,
  phone: `9190000000${id.slice(-1)}`,
  classification: 'Buyer',
  pref_property_types: ['Commercial Office Space'],
  pref_extracted_at: '2026-10-01T00:00:00Z',
});

function get() {
  return GET(
    new NextRequest(`http://x/api/v1/properties/${PROPERTY}/matches`),
    {
      params: Promise.resolve({ id: PROPERTY }),
    }
  );
}

beforeEach(() => {
  calls.length = 0;
  rows = {
    properties: building,
    contacts: [buyer('c-1', 'Ashwini'), buyer('c-2', 'Kabir')],
    listing_feedback: [],
  };
});

describe('[PRP-051] GET /api/v1/properties/[id]/matches', () => {
  it('ranks every contact when nobody was ruled out', async () => {
    const body = await (await get()).json();
    expect(
      body.items.map((m: { contact: { id: string } }) => m.contact.id)
    ).toHaveLength(2);
    expect(body.excluded_not_a_fit).toBe(0);
    expect(body.note).toBeUndefined();
  });

  it('leaves out a contact marked not a fit and says so', async () => {
    rows.listing_feedback = [
      {
        contact_id: 'c-2',
        reason: 'type',
        source: 'agent',
        created_at: '2026-10-24T00:00:00Z',
      },
    ];
    const body = await (await get()).json();
    expect(
      body.items.map((m: { contact: { id: string } }) => m.contact.id)
    ).toEqual(['c-1']);
    expect(body.total).toBe(1);
    expect(body.excluded_not_a_fit).toBe(1);
    expect(body.note).toMatch(/1 contact was left out/);
  });

  it("reads the listing's marks within the key's account", async () => {
    await get();
    const filters = calls
      .filter((c) => c.table === 'listing_feedback' && c.op === 'eq')
      .map((c) => c.args);
    expect(filters).toEqual([
      ['account_id', 'acc-1'],
      ['property_id', PROPERTY],
      ['verdict', 'rejected'],
    ]);
  });
});
