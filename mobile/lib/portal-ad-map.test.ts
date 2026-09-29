import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows: Record<string, unknown> = {};
const tablesRead: string[] = [];

vi.mock('./api', () => ({
  apiFetch: vi.fn(),
  isTimeout: (e: unknown) => (e as { status?: number })?.status === 408,
}));
vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      tablesRead.push(table);
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
      };
      return q;
    },
  },
}));

const { apiFetch } = await import('./api');
const { mapPortalAd, PORTAL_LINK_TIMEOUT_MS } = await import('./portal-ad-map');

const fetchMock = vi.mocked(apiFetch);
const ad = { portal: 'housing', portalListingId: '20645023' };
const ok = { data: { propertyTitle: 'Basil', taggedContacts: 2 } };
const timeout = { status: 408 };

describe('mapPortalAd', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    tablesRead.length = 0;
    for (const k of Object.keys(rows)) delete rows[k];
  });

  it('posts the listing with a budget longer than the default', async () => {
    fetchMock.mockResolvedValueOnce(ok);
    await expect(mapPortalAd('c1', 'p1', ad)).resolves.toEqual(ok.data);
    expect(fetchMock).toHaveBeenCalledWith('/api/contacts/c1/portal-link', {
      method: 'POST',
      body: JSON.stringify({ propertyId: 'p1' }),
      timeoutMs: PORTAL_LINK_TIMEOUT_MS,
    });
    expect(PORTAL_LINK_TIMEOUT_MS).toBeGreaterThan(20_000);
    expect(tablesRead).toEqual([]);
  });

  it('reports success when an abandoned request mapped the ad as an alias', async () => {
    fetchMock.mockRejectedValueOnce(timeout);
    rows.property_portal_listing_aliases = {
      property_id: 'p1',
      properties: { title: 'Basil' },
    };
    await expect(mapPortalAd('c1', 'p1', ad)).resolves.toEqual({
      propertyTitle: 'Basil',
      taggedContacts: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports success when an abandoned request mapped the primary id', async () => {
    fetchMock.mockRejectedValueOnce(timeout);
    rows.property_portal_listings = {
      property_id: 'p1',
      properties: { title: 'Basil' },
    };
    await expect(mapPortalAd('c1', 'p1', ad)).resolves.toMatchObject({
      propertyTitle: 'Basil',
    });
  });

  it('keeps the timeout when the ad is unmapped or mapped elsewhere', async () => {
    fetchMock.mockRejectedValueOnce(timeout);
    await expect(mapPortalAd('c1', 'p1', ad)).rejects.toBe(timeout);

    fetchMock.mockRejectedValueOnce(timeout);
    rows.property_portal_listings = { property_id: 'p2', properties: null };
    await expect(mapPortalAd('c1', 'p1', ad)).rejects.toBe(timeout);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never replays the mutation', async () => {
    fetchMock.mockRejectedValueOnce({ status: 409 });
    await expect(mapPortalAd('c1', 'p1', ad)).rejects.toEqual({ status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tablesRead).toEqual([]);
  });
});
