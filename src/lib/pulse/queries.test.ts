import { describe, expect, it, vi } from 'vitest';
import { PULSE_VIEWED_LISTINGS_LIMIT } from './feed-page';
import { loadPulseViewedListings } from './queries';
import { PULSE_LISTING_SORTS } from './viewed-listings';

function viewedRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    property_id: `p${i}`,
    title: `Listing ${i}`,
    property_code: `PROP-${i}`,
    price: 1000 * i,
    views_count: 40 - i,
    unique_views_count: 10,
    last_viewed_at: `2026-10-0${(i % 3) + 1}T10:00:00Z`,
  }));
}

function dbReturning(rows: ReturnType<typeof viewedRows>) {
  const rpc = vi.fn(() => Promise.resolve({ data: rows, error: null }));
  return {
    rpc,
    db: { rpc } as unknown as Parameters<typeof loadPulseViewedListings>[0],
  };
}

describe('[PLS-004] viewed listings', () => {
  it('asks for every viewed listing, not a top five', async () => {
    const rows = viewedRows(12);
    const { rpc, db } = dbReturning(rows);

    const listings = await loadPulseViewedListings(db, 'acc-1', 'views_desc');

    expect(rpc).toHaveBeenCalledWith('pulse_viewed_properties', {
      p_account_id: 'acc-1',
      p_sort: 'views_desc',
      p_limit: PULSE_VIEWED_LISTINGS_LIMIT,
    });
    expect(PULSE_VIEWED_LISTINGS_LIMIT).toBeGreaterThanOrEqual(500);
    expect(listings.map((row) => row.propertyId)).toEqual(
      rows.map((row) => row.property_id)
    );
  });
});

describe('[PLS-005] viewed listings sort', () => {
  it('offers views and last-viewed sorts in both directions', () => {
    expect(PULSE_LISTING_SORTS.map((option) => option.key)).toEqual([
      'views_desc',
      'views_asc',
      'recent_desc',
      'recent_asc',
    ]);
  });

  it.each(PULSE_LISTING_SORTS.map((option) => option.key))(
    'passes the %s sort to the database so the order holds past the bound',
    async (sort) => {
      const rows = viewedRows(3);
      const { rpc, db } = dbReturning(rows);

      const listings = await loadPulseViewedListings(db, 'acc-1', sort);

      expect(rpc).toHaveBeenCalledWith(
        'pulse_viewed_properties',
        expect.objectContaining({ p_sort: sort })
      );
      expect(listings.map((row) => row.propertyId)).toEqual(
        rows.map((row) => row.property_id)
      );
    }
  );

  it('carries each listing’s last view time', async () => {
    const { db } = dbReturning(viewedRows(1));

    const [listing] = await loadPulseViewedListings(db, 'acc-1', 'recent_desc');

    expect(listing.lastViewedAt).toBe('2026-10-01T10:00:00Z');
  });
});
