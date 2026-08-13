import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/portals/unmapped-ads — the queue of portal ads with leads
 * waiting and no mapping yet. The grouping and counting happen in SQL
 * (unmapped_portal_ads, migration 264); the route's own job is to hand
 * the client one row per ad in its own vocabulary.
 */

let rpcCalls: Array<{ name: string; args: unknown }>;
let rpcResult: { data?: unknown; error?: unknown };

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: async () => ({
    supabase: {
      rpc: (name: string, args: unknown) => {
        rpcCalls.push({ name, args });
        return Promise.resolve(rpcResult);
      },
    },
    accountId: 'acc-1',
    userId: 'user-1',
  }),
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    ),
}));

import { GET } from './route';

beforeEach(() => {
  rpcCalls = [];
  rpcResult = { data: [] };
});

describe('GET /api/portals/unmapped-ads', () => {
  it('names the caller account, never trusting one from the client', async () => {
    await GET();
    expect(rpcCalls).toEqual([
      { name: 'unmapped_portal_ads', args: { target_account_id: 'acc-1' } },
    ]);
  });

  it('reports one row per ad, with the leads waiting on it', async () => {
    rpcResult = {
      data: [
        {
          portal: 'housing',
          portal_listing_id: '20327451',
          // bigint comes back as a string over PostgREST on some drivers
          lead_count: '3',
          last_seen_at: '2026-08-13T00:37:00.000Z',
          sample_contact_id: 'c-1',
          sample_contact_name: 'Farzana Fm',
          guessed_property_id: 'p-hsr',
          guessed_property_title: '4 BHK Independent Bungalow in HSR Layout',
        },
      ],
    };

    const res = await GET();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toEqual([
      {
        portal: 'housing',
        portalListingId: '20327451',
        leadCount: 3,
        lastSeenAt: '2026-08-13T00:37:00.000Z',
        sampleContactId: 'c-1',
        sampleContactName: 'Farzana Fm',
        guessedPropertyId: 'p-hsr',
        guessedPropertyTitle: '4 BHK Independent Bungalow in HSR Layout',
      },
    ]);
  });

  it('is empty, not broken, when every ad is already mapped', async () => {
    rpcResult = { data: null };
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([]);
  });

  it('surfaces a database failure rather than an empty queue', async () => {
    rpcResult = { error: new Error('function does not exist') };
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
