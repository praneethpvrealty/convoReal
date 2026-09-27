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
} from './listing-status-sync';

const notify = vi.mocked(notifyBuyersOfPropertyStatus);

function fakeDb(previous: string | null, updated = true) {
  const filters: Array<[string, unknown]> = [];
  const builder = {
    select: () => builder,
    update: () => builder,
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return builder;
    },
    maybeSingle: () =>
      Promise.resolve({
        data: previous === null ? null : { status: previous },
      }),
    then: (resolve: (v: { data: unknown }) => unknown) =>
      Promise.resolve({ data: updated ? [{ id: 'p1' }] : [] }).then(resolve),
  };
  return {
    db: { from: () => builder } as unknown as SupabaseClient,
    filters,
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
