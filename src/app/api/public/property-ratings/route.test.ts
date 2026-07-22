import { describe, it, expect, beforeEach, vi } from 'vitest';

const state: {
  singleQueue: Record<string, Array<{ data: unknown }>>;
  listQueue: Record<string, Array<{ data: unknown }>>;
  upserted: Array<Record<string, unknown>>;
  likeInserted: Array<Record<string, unknown>>;
  likeDeleted: number;
} = {
  singleQueue: {},
  listQueue: {},
  upserted: [],
  likeInserted: [],
  likeDeleted: 0,
};

vi.mock('@/lib/automations/admin-client', () => {
  function makeBuilder(table: string) {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = chain;
    builder.eq = chain;
    builder.limit = chain;
    builder.upsert = (row: Record<string, unknown>) => {
      state.upserted.push(row);
      return Promise.resolve({ error: null });
    };
    builder.insert = (row: Record<string, unknown>) => {
      if (table === 'property_likes') state.likeInserted.push(row);
      return Promise.resolve({ error: null });
    };
    builder.delete = () => {
      if (table === 'property_likes') state.likeDeleted += 1;
      return builder;
    };
    builder.maybeSingle = () =>
      Promise.resolve(state.singleQueue[table]?.shift() ?? { data: null });
    // Awaiting the builder directly (list queries) resolves the list queue.
    builder.then = (resolve: (v: unknown) => unknown) =>
      resolve(state.listQueue[table]?.shift() ?? { data: [] });
    return builder;
  }
  return {
    supabaseAdmin: () => ({ from: (table: string) => makeBuilder(table) }),
  };
});

import { POST, GET } from './route';

const ACCOUNT = '11111111-1111-1111-1111-111111111111';
const PROPERTY = '22222222-2222-2222-2222-222222222222';
const SESSION = 'sess-rating';

function postReq(body: unknown) {
  return new Request('http://localhost/api/public/property-ratings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/public/property-ratings', () => {
  beforeEach(() => {
    state.singleQueue = {};
    state.listQueue = {};
    state.upserted = [];
    state.likeInserted = [];
    state.likeDeleted = 0;
  });

  it('rejects invalid ratings with 400', async () => {
    for (const rating of [0, 11, 5.5, undefined, 'high']) {
      const res = await POST(
        postReq({
          account_id: ACCOUNT,
          property_id: PROPERTY,
          session_key: SESSION,
          rating,
        })
      );
      expect(res.status).toBe(400);
    }
  });

  it('returns 404 when the property is not in the account', async () => {
    state.singleQueue.properties = [{ data: null }];
    const res = await POST(
      postReq({
        account_id: ACCOUNT,
        property_id: PROPERTY,
        session_key: SESSION,
        rating: 8,
      })
    );
    expect(res.status).toBe(404);
  });

  it('records a high rating, syncs a like, and returns the stats', async () => {
    state.singleQueue.properties = [
      { data: { id: PROPERTY } },
      { data: { rating_count: 4, rating_total: 30 } },
    ];
    const res = await POST(
      postReq({
        account_id: ACCOUNT,
        property_id: PROPERTY,
        session_key: SESSION,
        rating: 9,
        miss_reasons: ['budget'],
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ rating: 9, count: 4, average: 7.5 });
    expect(state.upserted).toHaveLength(1);
    expect(state.upserted[0]).toMatchObject({
      account_id: ACCOUNT,
      property_id: PROPERTY,
      session_key: SESSION,
      rating: 9,
      // High ratings never carry miss reasons.
      miss_reasons: [],
    });
    expect(state.likeInserted).toHaveLength(1);
    expect(state.likeDeleted).toBe(0);
  });

  it('records a low rating with whitelisted reasons and removes the like', async () => {
    state.singleQueue.properties = [
      { data: { id: PROPERTY } },
      { data: { rating_count: 1, rating_total: 4 } },
    ];
    const res = await POST(
      postReq({
        account_id: ACCOUNT,
        property_id: PROPERTY,
        session_key: SESSION,
        rating: 4,
        miss_reasons: ['budget', 'location', 'not-a-reason'],
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ rating: 4, count: 1, average: 4 });
    expect(state.upserted[0]).toMatchObject({
      rating: 4,
      miss_reasons: ['budget', 'location'],
    });
    expect(state.likeInserted).toHaveLength(0);
    expect(state.likeDeleted).toBe(1);
  });
});

describe('GET /api/public/property-ratings', () => {
  beforeEach(() => {
    state.singleQueue = {};
    state.listQueue = {};
    state.upserted = [];
    state.likeInserted = [];
    state.likeDeleted = 0;
  });

  it('returns stats and this session ratings', async () => {
    state.listQueue.properties = [
      {
        data: [
          { id: PROPERTY, rating_count: 2, rating_total: 15 },
          { id: 'p2', rating_count: 0, rating_total: 0 },
        ],
      },
    ];
    state.listQueue.property_ratings = [
      { data: [{ property_id: PROPERTY, rating: 8, miss_reasons: [] }] },
    ];
    const res = await GET(
      new Request(
        `http://localhost/api/public/property-ratings?account_id=${ACCOUNT}&session_key=${SESSION}`
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stats).toEqual({
      [PROPERTY]: { count: 2, average: 7.5 },
      p2: { count: 0, average: null },
    });
    expect(body.ratings).toEqual({
      [PROPERTY]: { rating: 8, miss_reasons: [] },
    });
  });

  it('returns empty payload for an invalid account', async () => {
    const res = await GET(
      new Request('http://localhost/api/public/property-ratings?account_id=bad')
    );
    const body = await res.json();
    expect(body).toEqual({ ratings: {}, stats: {} });
  });
});
