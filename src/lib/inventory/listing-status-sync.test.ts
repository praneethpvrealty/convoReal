import { describe, it, expect, vi, beforeEach } from 'vitest';
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
import {
  listingReopened,
  setListingStatusFromDeal,
  statusHeldByDeals,
} from './listing-status-sync';

const notify = vi.mocked(notifyBuyersOfPropertyStatus);

function fakeDb(
  previous: string | null,
  updated = true,
  deals: Array<{ status: string; stage: { name: string } | null }> = [],
  dealsError: { message: string } | null = null
) {
  const filters: Array<[string, unknown]> = [];
  const writes: unknown[] = [];
  let table = '';
  const builder = {
    select: () => builder,
    in: () => builder,
    update: (payload: unknown) => {
      writes.push(payload);
      return builder;
    },
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return builder;
    },
    maybeSingle: () =>
      Promise.resolve({
        data: previous === null ? null : { status: previous },
      }),
    then: (resolve: (v: { data: unknown; error?: unknown }) => unknown) =>
      Promise.resolve(
        table === 'deals'
          ? { data: dealsError ? null : deals, error: dealsError }
          : { data: updated ? [{ id: 'p1' }] : [] }
      ).then(resolve),
  };
  return {
    db: {
      from: (name: string) => {
        table = name;
        return builder;
      },
    } as unknown as SupabaseClient,
    filters,
    writes,
  };
}

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

  it('[PRP-014] tells enquirers when a pipeline move frees an under-contract listing', async () => {
    const { db, filters } = fakeDb('Under Contract');
    expect(await setListingStatusFromDeal(db, 'acc-1', 'p1', 'Available')).toBe(
      true
    );
    expect(filters).toContainEqual(['account_id', 'acc-1']);
    expect(scheduled).toHaveLength(1);
    await scheduled[0]();
    expect(notify).toHaveBeenCalledWith('acc-1', 'p1', 'Available');
  });

  it('stays quiet when the listing was already available or goes under contract', async () => {
    await setListingStatusFromDeal(
      fakeDb('Available').db,
      'acc-1',
      'p1',
      'Available'
    );
    await setListingStatusFromDeal(
      fakeDb('Available').db,
      'acc-1',
      'p1',
      'Under Contract'
    );
    expect(scheduled).toHaveLength(0);
  });

  it('[PRP-014] keeps a listing another deal still holds, and tells nobody it is available', async () => {
    const { db, writes } = fakeDb('Under Contract', true, [
      { status: 'open', stage: { name: 'Negotiation' } },
    ]);
    expect(await setListingStatusFromDeal(db, 'acc-1', 'p1', 'Available')).toBe(
      true
    );
    expect(writes).toEqual([{ status: 'Under Contract' }]);
    expect(scheduled).toHaveLength(0);
  });

  it('never lets a deal move overwrite a listing another deal has won', async () => {
    const { db, writes } = fakeDb('Sold', true, [
      { status: 'won', stage: { name: 'Registered' } },
      { status: 'open', stage: { name: 'Negotiation' } },
    ]);
    await setListingStatusFromDeal(db, 'acc-1', 'p1', 'Under Contract');
    expect(writes).toEqual([{ status: 'Sold' }]);
  });

  it('[PRP-014] writes nothing and tells nobody when the holding deals cannot be read', async () => {
    const { db, writes } = fakeDb('Under Contract', true, [], {
      message: 'timeout',
    });
    expect(await setListingStatusFromDeal(db, 'acc-1', 'p1', 'Available')).toBe(
      false
    );
    expect(writes).toEqual([]);
    expect(scheduled).toHaveLength(0);
  });

  it('reports a listing the update did not reach, and notifies nobody', async () => {
    expect(
      await setListingStatusFromDeal(
        fakeDb('Under Contract', false).db,
        'acc-1',
        'p1',
        'Available'
      )
    ).toBe(false);
    expect(scheduled).toHaveLength(0);
  });
});

describe('statusHeldByDeals', () => {
  it('returns the strongest status the remaining deals hold', () => {
    expect(statusHeldByDeals([])).toBeNull();
    expect(
      statusHeldByDeals([{ status: 'open', stage: { name: 'New Lead' } }])
    ).toBeNull();
    expect(
      statusHeldByDeals([{ status: 'open', stage: [{ name: 'Token Paid' }] }])
    ).toBe('Under Contract');
    expect(
      statusHeldByDeals([
        { status: 'open', stage: { name: 'Negotiation' } },
        { status: 'won', stage: null },
      ])
    ).toBe('Sold');
  });
});

describe('journey close and reopen', () => {
  it('[PRP-014] re-syncs every listing with a deal on the journey after its deals are closed or restored', async () => {
    const { readFileSync } = await import('node:fs');
    const route = readFileSync(
      new URL('../../app/api/journey/overview/route.ts', import.meta.url),
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
  });
});
