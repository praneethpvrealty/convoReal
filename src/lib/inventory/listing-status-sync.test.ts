import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

const scheduled: Array<() => Promise<unknown> | unknown> = [];

vi.mock('next/server', () => ({
  after: (task: () => Promise<unknown> | unknown) => {
    scheduled.push(task);
  },
}));

vi.mock('@/lib/whatsapp/sold-notification', () => ({
  notifyBuyersOfPropertyStatus: vi.fn().mockResolvedValue({ notified: 1 }),
}));

import { notifyBuyersOfPropertyStatus } from '@/lib/whatsapp/sold-notification';
import { propertyStatusForPipelineStage } from '@/lib/pipelines/stage-semantics';
import {
  listingReopened,
  listingsWithJourneyDeals,
  setListingStatusFromDeal,
} from './listing-status-sync';

const notify = vi.mocked(notifyBuyersOfPropertyStatus);

function rpcDb(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260927083000_listing_status_functions_search_path.sql'
  ),
  'utf8'
);

describe('listingReopened', () => {
  it('[PRP-014] fires only when a listing comes back to Available', () => {
    expect(listingReopened('Under Contract', 'Available')).toBe(true);
    expect(listingReopened('Off Market', 'Available')).toBe(true);
    expect(listingReopened('Sold', 'Available')).toBe(true);
    expect(listingReopened('Available', 'Available')).toBe(false);
    expect(listingReopened('Pending Review', 'Available')).toBe(false);
    expect(listingReopened(null, 'Available')).toBe(false);
    expect(listingReopened('Available', 'Under Contract')).toBe(false);
  });
});

describe('setListingStatusFromDeal', () => {
  beforeEach(() => {
    scheduled.length = 0;
    notify.mockClear();
  });

  it('[PRP-014] syncs through the locking database function, scoped to the account', async () => {
    const { db, rpc } = rpcDb({
      data: [{ previous_status: 'Available', new_status: 'Under Contract' }],
      error: null,
    });
    expect(
      await setListingStatusFromDeal(db, 'acc-1', 'p1', 'Under Contract')
    ).toBe(true);
    expect(rpc).toHaveBeenCalledWith('sync_listing_status_from_deals', {
      p_account_id: 'acc-1',
      p_property_id: 'p1',
      p_requested: 'Under Contract',
    });
    expect(scheduled).toHaveLength(0);
  });

  it('[PRP-014] tells enquirers when the synced listing comes back to Available', async () => {
    const { db } = rpcDb({
      data: [{ previous_status: 'Under Contract', new_status: 'Available' }],
      error: null,
    });
    await setListingStatusFromDeal(db, 'acc-1', 'p1', 'Available');
    expect(scheduled).toHaveLength(1);
    await scheduled[0]();
    expect(notify).toHaveBeenCalledWith('acc-1', 'p1', 'Available');
  });

  it('[PRP-014] tells nobody when another deal still holds the listing', async () => {
    const { db } = rpcDb({
      data: [
        { previous_status: 'Under Contract', new_status: 'Under Contract' },
      ],
      error: null,
    });
    await setListingStatusFromDeal(db, 'acc-1', 'p1', 'Available');
    expect(scheduled).toHaveLength(0);
  });

  it('[PRP-014] reports a failed sync and tells nobody', async () => {
    const failed = rpcDb({ data: null, error: { message: 'timeout' } });
    expect(
      await setListingStatusFromDeal(failed.db, 'acc-1', 'p1', 'Available')
    ).toBe(false);
    const missing = rpcDb({ data: [], error: null });
    expect(
      await setListingStatusFromDeal(missing.db, 'acc-1', 'p1', 'Available')
    ).toBe(false);
    expect(scheduled).toHaveLength(0);
  });
});

describe('listingsWithJourneyDeals', () => {
  it('returns every listing with a deal on the journey, or null when it cannot tell', async () => {
    const found = rpcDb({ data: ['p1', 'p2'], error: null });
    expect(
      await listingsWithJourneyDeals(found.db, 'acc-1', 'buyer', 'c1')
    ).toEqual(['p1', 'p2']);
    expect(found.rpc).toHaveBeenCalledWith('journey_deal_listings', {
      p_account_id: 'acc-1',
      p_mode: 'buyer',
      p_subject_id: 'c1',
    });
    const failed = rpcDb({ data: null, error: { message: 'timeout' } });
    expect(
      await listingsWithJourneyDeals(failed.db, 'acc-1', 'buyer', 'c1')
    ).toBeNull();
  });
});

describe('sync_listing_status_from_deals', () => {
  function sqlPattern(expression: RegExp): RegExp {
    const match = migration.match(expression);
    expect(match, String(expression)).not.toBeNull();
    return new RegExp(match![1]);
  }

  it('[PRP-014] reads the stages exactly as propertyStatusForPipelineStage does', () => {
    const lost = sqlPattern(/LIKE '%(\w+)%' THEN 0/);
    const sold = sqlPattern(/~ '(\([^']+\))' THEN 2/);
    const underContract = sqlPattern(/~ '(\([^']+\))' THEN 1/);
    const fromSql = (name: string) => {
      const n = name.trim().toLowerCase();
      if (lost.test(n)) return 'Available';
      if (sold.test(n)) return 'Sold';
      if (underContract.test(n)) return 'Under Contract';
      return null;
    };
    for (const stage of [
      'New Lead',
      'Site Visit',
      'Negotiation',
      'Token Paid',
      'Due Diligence',
      'Agreement / Contract',
      'Registered',
      'Won',
      'Brokerage Pending',
      'Brokerage Paid',
      'Lost',
      'Closed Lost',
    ]) {
      const ts = propertyStatusForPipelineStage(stage);
      expect(fromSql(stage), stage).toBe(ts === 'Available' ? 'Available' : ts);
    }
  });

  it('locks the listing and keeps the strongest status its deals hold', () => {
    expect(migration).toContain('FOR UPDATE;');
    expect(migration).not.toMatch(/OR p_requested = /);
    expect(
      migration.match(/SET search_path = public, pg_temp\n/g)
    ).toHaveLength(2);
    expect(migration).not.toMatch(/SET search_path = public\n/);
    expect(migration).toContain("WHEN d.status = 'won' THEN 2");
    expect(migration).toContain("AND d.status IN ('open', 'won')");
    expect(migration).toContain('v_target := CASE v_held');
    expect(
      migration.match(/is_account_member\(p_account_id, 'agent'\)/g)
    ).toHaveLength(2);
  });
});

describe('journey close and reopen', () => {
  it('[PRP-014] re-syncs every listing with a deal on the journey, and says so when it cannot', () => {
    const route = readFileSync(
      join(process.cwd(), 'src/app/api/journey/overview/route.ts'),
      'utf8'
    );
    expect(route).toContain(
      "if (mutation.action === 'close' || mutation.action === 'reopen') {"
    );
    expect(route).toMatch(
      /listingsWithJourneyDeals\(\s*supabase,\s*accountId,\s*mutation\.mode,\s*mutation\.subjectId\s*\)/
    );
    expect(route).toMatch(
      /setListingStatusFromDeal\(\s*supabase,\s*accountId,\s*propertyId,\s*'Available'\s*\)/
    );
    expect(route).toContain("code: 'LISTING_SYNC_FAILED'");
  });

  it('routes a journey-to-deal conversion through the same sync', () => {
    const convert = readFileSync(
      join(process.cwd(), 'src/lib/deals/convert-journey-item.ts'),
      'utf8'
    );
    expect(convert).toMatch(
      /setListingStatusFromDeal\(\s*ctx\.supabase,\s*ctx\.accountId,\s*item\.property_id,\s*propertyStatusForPipelineStage\(stage\.name\) \?\? 'Available'\s*\)/
    );
    expect(convert).not.toContain('.update({ status: propertyStatus })');
  });

  it("[PRP-014] releases a deleted deal's listing through the same sync", () => {
    const remove = readFileSync(
      join(process.cwd(), 'src/lib/deals/delete-deal.ts'),
      'utf8'
    );
    expect(remove).toMatch(
      /setListingStatusFromDeal\(\s*ctx\.supabase,\s*ctx\.accountId,\s*deal\.property_id,\s*'Available'\s*\)/
    );
    expect(remove).not.toContain(".update({ status: 'Available' })");
  });

  it("[PRP-014] syncs an edited deal's listing through the same sync", () => {
    const route = readFileSync(
      join(process.cwd(), 'src/app/api/deals/[id]/route.ts'),
      'utf8'
    );
    expect(route).toMatch(
      /setListingStatusFromDeal\(\s*ctx\.supabase,\s*ctx\.accountId,\s*effectivePropertyId,\s*propertyStatus\s*\)/
    );
    expect(route).not.toContain('.update({ status: propertyStatus })');
    expect(route).toMatch(
      /previousPropertyId && previousPropertyId !== updateData\.property_id\) \{\s*const released = await setListingStatusFromDeal\(\s*ctx\.supabase,\s*ctx\.accountId,\s*previousPropertyId,\s*'Available'\s*\)/
    );
  });

  it("[PRP-014] re-syncs a branch's listings when it is dropped or reactivated", () => {
    const route = readFileSync(
      join(process.cwd(), 'src/app/api/journey/status/route.ts'),
      'utf8'
    );
    expect(route).toContain(".eq('source_journey_item_id', itemId)");
    expect(route).toMatch(
      /setListingStatusFromDeal\(\s*ctx\.supabase,\s*ctx\.accountId,\s*propertyId,\s*'Available'\s*\)/
    );
    expect(route).toContain("code: 'LISTING_SYNC_FAILED'");
    const section = readFileSync(
      join(process.cwd(), 'src/components/journey/journey-section.tsx'),
      'utf8'
    );
    expect(section).toContain("fetch('/api/journey/status'");
    expect(section).toContain(
      "committed: json?.code === 'LISTING_SYNC_FAILED'"
    );
    expect(section.match(/if \(!committed\) return;/g)).toHaveLength(2);
    expect(section).not.toMatch(/status: 'dropped',\s*drop_reason: reason/);
  });
});
