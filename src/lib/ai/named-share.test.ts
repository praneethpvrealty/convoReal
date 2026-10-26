import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { detailsRequestForSharedListing } from './named-share';
import { asksDetailsOfDescribedListing } from './requirement-signal';
import { isBuyerRequirementMessage } from './lead-routing';

const hopefarm = {
  id: 'p-1014',
  title: 'Commercial Rental Income Building for Sale in Hopefarm Whitefield',
  location: 'Hopefarm, Whitefield',
  price: 480_000_000,
  area_sqft: 34_200,
};
const plot = {
  id: 'p-1018',
  title: 'Vacant plot for sale in Whitefield',
  location: 'Pattandur Agrahara, Whitefield',
  price: 43_200_000,
  land_area: 3089,
  land_area_unit: 'sqft',
};

function fakeDb(shared: Array<Record<string, unknown>>) {
  const tables: Record<string, unknown[]> = {
    property_shares: shared.map((p) => ({ property_id: p.id })),
    properties: shared,
  };
  const calls: Array<{ table: string; filters: string[] }> = [];
  const db = {
    from(table: string) {
      const call = { table, filters: [] as string[] };
      calls.push(call);
      const chain = {
        select: () => chain,
        eq: (col: string, value: string) => {
          call.filters.push(`${col}=${value}`);
          return chain;
        },
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        then: (resolve: (v: { data: unknown[] }) => void) =>
          resolve({ data: tables[table] }),
      };
      return chain;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

describe('[INB-043] a details request naming a shared listing is not a requirement', () => {
  const text = 'Commercial property in hope farm 48 cr,  details ?';

  it('reads the reported message as a details request, not a search', () => {
    expect(isBuyerRequirementMessage(text)).toBe(true);
    expect(asksDetailsOfDescribedListing(text)).toBe(true);
    for (const search of [
      'Looking for commercial property 48 cr, details?',
      'Any commercial building under 50 cr? details please',
      'Do you have a 3 BHK in Whitefield',
      '4 BHK house',
    ]) {
      expect(asksDetailsOfDescribedListing(search), search).toBe(false);
    }
  });

  it('names the listing already shared, by its price', async () => {
    const { db, calls } = fakeDb([hopefarm, plot]);
    await expect(
      detailsRequestForSharedListing(db, 'acc-1', 'c-1', text)
    ).resolves.toBe('p-1014');
    for (const call of calls)
      expect(call.filters).toContain('account_id=acc-1');
  });

  it('names nothing when no shared listing carries the figure', async () => {
    const { db } = fakeDb([plot]);
    await expect(
      detailsRequestForSharedListing(db, 'acc-1', 'c-1', text)
    ).resolves.toBeNull();
  });

  it('names nothing when nothing was shared, so the ladder keeps it', async () => {
    const { db } = fakeDb([]);
    await expect(
      detailsRequestForSharedListing(db, 'acc-1', 'c-1', text)
    ).resolves.toBeNull();
  });

  it('never reads the database for a message that asks for no details', async () => {
    const { db, calls } = fakeDb([hopefarm]);
    await expect(
      detailsRequestForSharedListing(db, 'acc-1', 'c-1', 'Commercial 48 cr')
    ).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });
});
