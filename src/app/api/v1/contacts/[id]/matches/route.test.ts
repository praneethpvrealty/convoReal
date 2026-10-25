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
vi.mock('@/lib/buyer/matches-ranking', () => ({
  hasBuyerBrief: () => true,
  curateForBuyer: (properties: { id: string }[]) =>
    properties.map((property) => ({
      property,
      score: 90,
      details: {},
      reasons: [],
    })),
}));

const { GET } = await import('./route');

const CONTACT = 'c-1';

function get() {
  return GET(new NextRequest(`http://x/api/v1/contacts/${CONTACT}/matches`), {
    params: Promise.resolve({ id: CONTACT }),
  });
}

beforeEach(() => {
  calls.length = 0;
  rows = {
    contacts: { id: CONTACT, name: 'Ashwini', classification: 'Buyer' },
    properties: [
      { id: 'p-1', title: 'Site', status: 'Available' },
      { id: 'p-2', title: 'Office block', status: 'Available' },
    ],
    listing_feedback: [],
  };
});

describe('[PRP-051] GET /api/v1/contacts/[id]/matches', () => {
  it('leaves out a listing the contact was ruled out for and says so', async () => {
    rows.listing_feedback = [{ property_id: 'p-2' }];
    const body = await (await get()).json();
    expect(
      body.items.map((m: { property: { id: string } }) => m.property.id)
    ).toEqual(['p-1']);
    expect(body.total).toBe(1);
    expect(body.excluded_not_a_fit).toBe(1);
    expect(body.note).toMatch(/1 listing was left out/);
  });

  it('keeps everything and adds no note when nothing was ruled out', async () => {
    const body = await (await get()).json();
    expect(body.items).toHaveLength(2);
    expect(body.excluded_not_a_fit).toBe(0);
    expect(body.note).toBeUndefined();
  });

  it("reads the contact's rejections within the key's account", async () => {
    await get();
    const filters = calls
      .filter((c) => c.table === 'listing_feedback' && c.op === 'eq')
      .map((c) => c.args);
    expect(filters).toEqual([
      ['account_id', 'acc-1'],
      ['contact_id', CONTACT],
      ['verdict', 'rejected'],
    ]);
  });
});
