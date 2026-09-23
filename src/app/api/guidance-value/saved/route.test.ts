import { beforeEach, describe, expect, it, vi } from 'vitest';

let rate: Record<string, unknown> | null;
const inserted: Record<string, unknown>[] = [];

function chain(result: () => unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'limit']) {
    builder[method] = () => builder;
  }
  builder.maybeSingle = async () => ({ data: result() });
  builder.single = async () => ({ data: inserted.at(-1), error: null });
  builder.insert = (row: Record<string, unknown>) => {
    inserted.push(row);
    return builder;
  };
  return builder;
}

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: async () => ({}),
  requireWriteRole: async () => ({
    accountId: 'acc-1',
    userId: 'user-1',
    supabase: {
      from: (table: string) =>
        chain(() => (table === 'properties' ? { id: 'prop-1' } : null)),
    },
  }),
  toErrorResponse: (err: unknown) =>
    Response.json({ error: String(err) }, { status: 500 }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => chain(() => rate) }),
}));

import { POST } from './route';

const PROPERTY = '11111111-1111-4111-8111-111111111111';
const RATE = '22222222-2222-4222-8222-222222222222';

function save(body: Record<string, unknown>) {
  return POST(
    new Request('http://test/api/guidance-value/saved', {
      method: 'POST',
      body: JSON.stringify({ property_id: PROPERTY, rate_id: RATE, ...body }),
    })
  );
}

beforeEach(() => {
  inserted.length = 0;
  rate = {
    id: RATE,
    locality: 'Koramangala 6th Block',
    road: '18th Main',
    property_class: 'residential_site',
    rate: '10000',
    unit: 'sqft',
    page: 4,
    source: { title: 'Bengaluru Urban 2023', effective_from: '2023-10-01' },
  };
});

describe('POST /api/guidance-value/saved', () => {
  it('[GVL-004] recomputes the value from the stored rate, ignoring a client total', async () => {
    const res = await save({
      total_value: 1,
      schedule: {
        locality: 'Koramangala 6th Block',
        built_up_area: { value: 4319, unit: 'sqft' },
      },
      options: { land_area_sqft: 2400 },
    });
    expect(res.status).toBe(201);
    expect(inserted[0]).toMatchObject({
      account_id: 'acc-1',
      property_id: PROPERTY,
      land_area_sqft: 2400,
      total_value: 24000000,
      rate_snapshot: { rate: 10000, source_title: 'Bengaluru Urban 2023' },
    });
  });

  it('refuses to save without the area the rate needs', async () => {
    const res = await save({ schedule: { locality: 'Koramangala 6th Block' } });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('AREA_REQUIRED');
    expect(inserted).toHaveLength(0);
  });

  it('404s an unknown rate', async () => {
    rate = null;
    const res = await save({ schedule: {}, options: { land_area_sqft: 100 } });
    expect(res.status).toBe(404);
  });

  it('requires a property or deal', async () => {
    const res = await POST(
      new Request('http://test/api/guidance-value/saved', {
        method: 'POST',
        body: JSON.stringify({ rate_id: RATE }),
      })
    );
    expect(res.status).toBe(400);
  });
});
