import { describe, expect, it, vi } from 'vitest';
import { PULSE_VIEWED_LISTINGS_LIMIT } from './feed-page';
import { loadPulseStats } from './queries';

describe('[PLS-004] viewed listings', () => {
  it('asks for every viewed listing, not a top five', async () => {
    const viewed = Array.from({ length: 12 }, (_, i) => ({
      property_id: `p${i}`,
      title: `Listing ${i}`,
      property_code: `PROP-${i}`,
      price: 1000 * i,
      views_count: 40 - i,
      unique_views_count: 10,
    }));
    const rpc = vi.fn((name: string) =>
      name === 'pulse_stats'
        ? {
            maybeSingle: async () => ({
              data: { total_views: 1, unique_sessions: 1, avg_dwell_sec: 1 },
              error: null,
            }),
          }
        : Promise.resolve({ data: viewed, error: null })
    );

    const stats = await loadPulseStats(
      { rpc } as unknown as Parameters<typeof loadPulseStats>[0],
      'acc-1'
    );

    expect(rpc).toHaveBeenCalledWith('pulse_top_properties', {
      p_account_id: 'acc-1',
      p_limit: PULSE_VIEWED_LISTINGS_LIMIT,
    });
    expect(PULSE_VIEWED_LISTINGS_LIMIT).toBeGreaterThanOrEqual(500);
    expect(stats.topProperties.map((row) => row.property.id)).toEqual(
      viewed.map((row) => row.property_id)
    );
  });
});
