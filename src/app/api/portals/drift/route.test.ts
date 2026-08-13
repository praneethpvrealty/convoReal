import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/portals/drift — mapped portal ads whose recorded state has
 * diverged from reality. The four checks live in SQL
 * (portal_listing_drift, migration 267); the route's own job is to hand
 * the client one row per finding in its own vocabulary.
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

describe('GET /api/portals/drift', () => {
  it('names the caller account, never trusting one from the client', async () => {
    await GET();
    expect(rpcCalls).toEqual([
      { name: 'portal_listing_drift', args: { target_account_id: 'acc-1' } },
    ]);
  });

  it('reports one row per finding, with the facts that support it', async () => {
    rpcResult = {
      data: [
        {
          portal: 'magicbricks',
          portal_listing_id: '85514527',
          listing_url: 'https://www.magicbricks.com/property/85514527',
          expires_on: '2026-09-02',
          property_id: 'p-1083',
          property_title: 'Residential Plot in Devanahalli',
          property_code: 'PROP-1083',
          property_status: 'Archived',
          drift_kind: 'withdrawn_stock',
          // bigint comes back as a string over PostgREST on some drivers
          lead_count: '3',
          last_lead_at: '2026-08-12T09:14:00.000Z',
          parsed_property_type: null,
          parsed_price: null,
          parsed_area_sqft: null,
          listing_type: 'Residential Plot',
          listing_price: '9500000',
          listing_area_sqft: '2400',
        },
      ],
    };

    const res = await GET();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toEqual([
      {
        portal: 'magicbricks',
        portalListingId: '85514527',
        listingUrl: 'https://www.magicbricks.com/property/85514527',
        expiresOn: '2026-09-02',
        propertyId: 'p-1083',
        propertyTitle: 'Residential Plot in Devanahalli',
        propertyCode: 'PROP-1083',
        propertyStatus: 'Archived',
        driftKind: 'withdrawn_stock',
        leadCount: 3,
        lastLeadAt: '2026-08-12T09:14:00.000Z',
        parsedPropertyType: null,
        parsedPrice: null,
        parsedAreaSqft: null,
        listingType: 'Residential Plot',
        listingPrice: 9500000,
        listingAreaSqft: 2400,
      },
    ]);
  });

  it('carries both sides of a details drift so the UI can show the disagreement', async () => {
    rpcResult = {
      data: [
        {
          portal: 'magicbricks',
          portal_listing_id: '85514527',
          listing_url: null,
          expires_on: null,
          property_id: 'p-1083',
          property_title: 'Residential Plot in Devanahalli',
          property_code: 'PROP-1083',
          property_status: 'Available',
          drift_kind: 'details_drift',
          lead_count: 2,
          last_lead_at: '2026-08-12T09:14:00.000Z',
          parsed_property_type: 'Commercial Land',
          parsed_price: '12000000',
          parsed_area_sqft: null,
          listing_type: 'Residential Plot',
          listing_price: '9500000',
          listing_area_sqft: '2400',
        },
      ],
    };

    const res = await GET();
    const { data } = await res.json();
    expect(data[0].driftKind).toBe('details_drift');
    expect(data[0].parsedPropertyType).toBe('Commercial Land');
    expect(data[0].listingType).toBe('Residential Plot');
    expect(data[0].parsedPrice).toBe(12000000);
    expect(data[0].listingPrice).toBe(9500000);
  });

  it('is empty, not broken, when nothing has drifted', async () => {
    rpcResult = { data: null };
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([]);
  });

  it('surfaces a database failure rather than a clean bill of health', async () => {
    rpcResult = { error: new Error('function does not exist') };
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
