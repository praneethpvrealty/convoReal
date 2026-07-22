import { describe, it, expect, beforeEach, vi } from 'vitest';

const state: {
  singleQueue: Record<string, Array<{ data: unknown }>>;
  listQueue: Record<string, Array<{ data: unknown }>>;
  inserted: Array<Record<string, unknown>>;
  deleted: number;
} = { singleQueue: {}, listQueue: {}, inserted: [], deleted: 0 };

vi.mock('@/lib/automations/admin-client', () => {
  function makeBuilder(table: string) {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = chain;
    builder.eq = chain;
    builder.insert = (row: Record<string, unknown>) => {
      state.inserted.push(row);
      return Promise.resolve({ error: null });
    };
    builder.delete = () => {
      state.deleted += 1;
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
const SESSION = 'sess-abc';

function postReq(body: unknown) {
  return new Request('http://localhost/api/public/property-likes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/public/property-likes', () => {
  beforeEach(() => {
    state.singleQueue = {};
    state.listQueue = {};
    state.inserted = [];
    state.deleted = 0;
  });

  it('rejects invalid input with 400', async () => {
    const res = await POST(
      postReq({
        account_id: 'nope',
        property_id: PROPERTY,
        session_key: SESSION,
      })
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when the property is not in the account', async () => {
    state.singleQueue.properties = [{ data: null }];
    const res = await POST(
      postReq({
        account_id: ACCOUNT,
        property_id: PROPERTY,
        session_key: SESSION,
        liked: true,
      })
    );
    expect(res.status).toBe(404);
  });

  it('records a like and returns the fresh count', async () => {
    state.singleQueue.properties = [
      { data: { id: PROPERTY } },
      { data: { like_count: 5 } },
    ];
    const res = await POST(
      postReq({
        account_id: ACCOUNT,
        property_id: PROPERTY,
        session_key: SESSION,
        liked: true,
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ liked: true, count: 5 });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      account_id: ACCOUNT,
      property_id: PROPERTY,
      session_key: SESSION,
    });
  });

  it('removes a like when liked is false', async () => {
    state.singleQueue.properties = [
      { data: { id: PROPERTY } },
      { data: { like_count: 4 } },
    ];
    const res = await POST(
      postReq({
        account_id: ACCOUNT,
        property_id: PROPERTY,
        session_key: SESSION,
        liked: false,
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ liked: false, count: 4 });
    expect(state.deleted).toBe(1);
    expect(state.inserted).toHaveLength(0);
  });
});

describe('GET /api/public/property-likes', () => {
  beforeEach(() => {
    state.singleQueue = {};
    state.listQueue = {};
    state.inserted = [];
    state.deleted = 0;
  });

  it('returns counts and this session liked ids', async () => {
    state.listQueue.properties = [
      {
        data: [
          { id: PROPERTY, like_count: 3 },
          { id: 'p2', like_count: 0 },
        ],
      },
    ];
    state.listQueue.property_likes = [{ data: [{ property_id: PROPERTY }] }];
    const res = await GET(
      new Request(
        `http://localhost/api/public/property-likes?account_id=${ACCOUNT}&session_key=${SESSION}`
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts).toEqual({ [PROPERTY]: 3, p2: 0 });
    expect(body.liked).toEqual([PROPERTY]);
  });

  it('returns empty payload for an invalid account', async () => {
    const res = await GET(
      new Request('http://localhost/api/public/property-likes?account_id=bad')
    );
    const body = await res.json();
    expect(body).toEqual({ counts: {}, liked: [] });
  });
});
