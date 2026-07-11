import { describe, it, expect, vi } from 'vitest';
import { GET } from './route';
import type { Property } from '@/types';

// Mock DB candidate pool
const mockCandidates: Partial<Property>[] = [
  {
    id: 'prop-1',
    account_id: 'acc-123',
    title: 'Matching Sublocality & Price Apartment',
    type: 'Apartment',
    listing_type: 'Sale',
    price: 12000000, // 1.2 Cr (within 30% of 1 Cr)
    sublocality: 'hsr layout',
    location: 'HSR Layout Sector 2',
    city: 'bangalore',
    bedrooms: 3,
    latitude: 12.91,
    longitude: 77.64,
    is_published: true,
    status: 'Available',
    created_at: new Date(Date.now() - 1000).toISOString()
  },
  {
    id: 'prop-2',
    account_id: 'acc-123',
    title: 'Matching Type only Plot',
    type: 'Apartment',
    listing_type: 'Sale',
    price: 30000000, // 3 Cr (outside 50% price band)
    sublocality: 'whitefield',
    location: 'Whitefield Main Road',
    city: 'bangalore',
    bedrooms: 2,
    latitude: 12.96,
    longitude: 77.75,
    is_published: true,
    status: 'Available',
    created_at: new Date(Date.now() - 2000).toISOString()
  },
  {
    id: 'prop-3',
    account_id: 'acc-123',
    title: 'Matching Rent Flat',
    type: 'Apartment',
    listing_type: 'Rent',
    rent_per_month: 40000, // matches rent criteria
    sublocality: 'hsr layout',
    location: 'HSR Layout Sector 3',
    city: 'bangalore',
    bedrooms: 3,
    latitude: 12.912,
    longitude: 77.642,
    is_published: true,
    status: 'Available',
    created_at: new Date(Date.now() - 3000).toISOString()
  }
];

// Mock the admin client
vi.mock('@/lib/automations/admin-client', () => {
  const mockSupabase = {
    from: vi.fn().mockImplementation(() => {
      const builder = {
        select: vi.fn().mockImplementation(() => builder),
        eq: vi.fn().mockImplementation(() => builder),
        neq: vi.fn().mockImplementation(() => builder),
        order: vi.fn().mockImplementation(() => builder),
        limit: vi.fn().mockImplementation(() => {
          return Promise.resolve({ data: mockCandidates, error: null });
        })
      };
      return builder;
    })
  };
  return {
    supabaseAdmin: () => mockSupabase
  };
});

describe('GET /api/public/properties/similar', () => {
  it('should return 400 if required query params are missing', async () => {
    const req = new Request('http://localhost/api/public/properties/similar');
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Missing required");
  });

  it('should correctly score and rank similar properties', async () => {
    const params = new URLSearchParams({
      account_id: 'acc-123',
      property_id: 'seed-prop',
      type: 'Apartment',
      listing_type: 'Sale',
      price: '10000000', // 1 Cr seed price
      rent: '0',
      bedrooms: '3',
      sublocality: 'hsr layout',
      location: 'HSR Layout Sector 1',
      city: 'bangalore',
      lat: '12.908',
      lon: '77.638'
    });

    const req = new Request(`http://localhost/api/public/properties/similar?${params.toString()}`);
    const res = await GET(req);
    expect(res.status).toBe(200);

    const { data } = (await res.json()) as { data: (Property & { _similarity_score: number; _match_reasons: string[] })[] };
    expect(data.length).toBe(3);

    // prop-1 should rank first: matching sublocality, listing_type, price band, type, bedrooms, geo proximity
    const first = data[0];
    expect(first.id).toBe('prop-1');
    expect(first._similarity_score).toBeGreaterThan(50);
    expect(first._match_reasons).toContain('same_area');
    expect(first._match_reasons).toContain('same_type');
    expect(first._match_reasons).toContain('similar_price');

    // prop-2 matches listing_type + type but price is far and location differs
    const second = data.find(p => p.id === 'prop-2');
    expect(second).toBeDefined();
    expect(second?._similarity_score).toBeLessThan(first._similarity_score);
  });
});
