import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMPTY_INVENTORY_STATS, parseInventoryOverview } from './overview';

describe('parseInventoryOverview', () => {
  it('[PRP-074] reads the three shapes the composed functions return', () => {
    const overview = parseInventoryOverview({
      stats: {
        total: 12,
        published: 5,
        available: 7,
        sold_or_contract: 2,
        pending_review: 1,
        active_total: 10,
        direct: 6,
        agent_referred: 4,
      },
      attention: [
        {
          agent_referred: false,
          listings: 3,
          no_photos: 1,
          no_price: 1,
          no_pin: 2,
        },
      ],
      source_breakdown: [
        {
          status: 'Available',
          is_published: true,
          agent_referred: false,
          listings: 7,
        },
      ],
    });

    expect(overview.stats).toEqual({
      total: 12,
      published: 5,
      available: 7,
      soldOrContract: 2,
      pendingReview: 1,
      activeTotal: 10,
    });
    expect(overview.attention).toHaveLength(1);
    expect(overview.sourceBreakdown[0].listings).toBe(7);
  });

  it('[PRP-074] reads a non-member NULL as an empty overview', () => {
    expect(parseInventoryOverview(null)).toEqual({
      stats: EMPTY_INVENTORY_STATS,
      attention: [],
      sourceBreakdown: [],
    });
  });

  it('[PRP-074] the SQL composes the three functions behind the membership guard', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        'supabase/migrations/20261128043149_inventory_overview.sql'
      ),
      'utf8'
    );
    expect(sql).toContain('public.is_account_member(p_account_id)');
    expect(sql).toContain('public.inventory_stats(p_account_id)');
    expect(sql).toContain('public.inventory_attention_counts(p_account_id)');
    expect(sql).toContain('public.inventory_source_breakdown(p_account_id)');
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.inventory_overview(UUID) TO authenticated'
    );
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.inventory_overview(UUID) FROM anon'
    );
  });
});
