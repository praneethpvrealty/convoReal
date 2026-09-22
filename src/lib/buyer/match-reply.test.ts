import { describe, expect, it } from 'vitest';
import {
  buildBuyerMatchReply,
  buildBuyerMatchReplyWithListings,
} from './match-reply';

function dbForUnavailableEnquiry() {
  const rows = {
    contacts: [
      {
        id: 'vinutha',
        account_id: 'account',
        name: 'Vinutha',
        requirements: '3 BHK in HSR Layout around 3 crore',
        last_inquired_property_id: 'palm-grove',
      },
    ],
    properties: [
      {
        id: 'palm-grove',
        account_id: 'account',
        title: 'Palm Grove',
        status: 'Sold',
        is_published: true,
      },
    ],
  };

  return {
    rpc: async () => ({ data: [], error: null }),
    from(table: keyof typeof rows) {
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return query;
        },
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({
          data:
            rows[table].find((row) =>
              Object.entries(filters).every(
                ([column, value]) =>
                  (row as Record<string, unknown>)[column] === value
              )
            ) || null,
        }),
        then(resolve: (value: { data: unknown[] }) => unknown) {
          return Promise.resolve({
            data: rows[table].filter((row) =>
              Object.entries(filters).every(
                ([column, value]) =>
                  (row as Record<string, unknown>)[column] === value
              )
            ),
          }).then(resolve);
        },
      };
      return query;
    },
  };
}

function dbForAvailableEnquiry(withBrief = true) {
  const rows = {
    contacts: [
      {
        id: 'simon',
        account_id: 'account',
        name: 'Simon',
        requirements: withBrief ? 'Villa in KR Puram within 3 crore' : null,
        property_interests: withBrief ? ['Villa'] : null,
        areas_of_interest: withBrief ? ['KR Puram'] : null,
        max_budget: withBrief ? 30_000_000 : null,
        last_inquired_property_id: 'hebron',
      },
    ],
    properties: [
      {
        id: 'hebron',
        account_id: 'account',
        title: '4 BHK Villa in Hebron Enclave',
        type: 'Villa',
        listing_type: 'Sale',
        location: 'TC Palaya, KR Puram',
        sublocality: 'KR Puram',
        city: 'Bangalore',
        bedrooms: 4,
        price: 42_000_000,
        status: 'Available',
        is_published: true,
        property_code: 'PROP-HEBRON',
      },
      {
        id: 'alternative',
        account_id: 'account',
        title: 'KR Puram Villa',
        type: 'Villa',
        listing_type: 'Sale',
        location: 'KR Puram',
        sublocality: 'KR Puram',
        city: 'Bangalore',
        bedrooms: 4,
        price: 28_000_000,
        status: 'Available',
        is_published: true,
        created_at: '2026-08-17T00:00:00Z',
      },
    ],
  };

  return {
    rpc: async () => ({ data: [], error: null }),
    from(table: keyof typeof rows) {
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return query;
        },
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({
          data:
            rows[table].find((row) =>
              Object.entries(filters).every(
                ([column, value]) =>
                  (row as Record<string, unknown>)[column] === value
              )
            ) || null,
        }),
        then(resolve: (value: { data: unknown[] }) => unknown) {
          return Promise.resolve({
            data: rows[table].filter((row) =>
              Object.entries(filters).every(
                ([column, value]) =>
                  (row as Record<string, unknown>)[column] === value
              )
            ),
          }).then(resolve);
        },
      };
      return query;
    },
  };
}

function dbForPortalPlotLead() {
  const rows: Record<string, Record<string, unknown>[]> = {
    contacts: [
      {
        id: 'sandhiya',
        account_id: 'account',
        name: 'sandhiya durai',
        pref_property_types: ['Vacant plot'],
        property_interests: ['Vacant plot'],
        pref_areas: ['KHB Suryanagar Phase'],
        last_inquired_property_id: null,
      },
    ],
    properties: [
      {
        id: 'commercial',
        account_id: 'account',
        title: 'Semi-Commercial Plot in Suryanagar Phase 1',
        type: 'Commercial Land',
        listing_type: 'Sale',
        location: 'Suryanagar phase 1, Bangalore',
        price: 60_000_000,
        status: 'Available',
        is_published: true,
      },
    ],
  };
  const matches = (table: string, filters: Record<string, unknown>) =>
    rows[table].filter((row) =>
      Object.entries(filters).every(([column, value]) => row[column] === value)
    );

  return {
    rpc: async () => ({ data: [], error: null }),
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return query;
        },
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({
          data: matches(table, filters)[0] || null,
        }),
        then(resolve: (value: { data: unknown[] }) => unknown) {
          return Promise.resolve({ data: matches(table, filters) }).then(
            resolve
          );
        },
      };
      return query;
    },
  };
}

describe('buildBuyerMatchReply', () => {
  it('[INB-014] asks a portal lead with no budget for one instead of dead-ending', async () => {
    const reply = await buildBuyerMatchReply({
      accountId: 'account',
      contactId: 'sandhiya',
      db: dbForPortalPlotLead() as never,
    });

    expect(reply).toBe(
      "Hi sandhiya — I don't have a vacant plot in KHB Suryanagar Phase live right now, but I'm watching for one. " +
        "What budget are you working with? I'll widen the search to everything within it."
    );
  });

  it('shows the available enquiry first even when the current brief would exclude it', async () => {
    const reply = await buildBuyerMatchReply({
      accountId: 'account',
      contactId: 'simon',
      db: dbForAvailableEnquiry() as never,
    });

    expect(reply).toContain("Here's the property you enquired about");
    expect(reply).toContain('Property you enquired about');
    expect(reply?.indexOf('4 BHK Villa in Hebron Enclave')).toBeLessThan(
      reply?.indexOf('KR Puram Villa') ?? 0
    );
    expect(reply).not.toContain('nothing in our inventory fits');
  });

  it('shows the exact enquiry even before the buyer has supplied a broader brief', async () => {
    const reply = await buildBuyerMatchReply({
      accountId: 'account',
      contactId: 'simon',
      db: dbForAvailableEnquiry(false) as never,
    });

    expect(reply).toContain('4 BHK Villa in Hebron Enclave');
    expect(reply).not.toContain('KR Puram Villa');
    expect(reply).toContain('property_id=PROP-HEBRON');
    expect(reply).toContain('v=simon');
    expect(reply).not.toContain('/buyer/login');
  });

  it('explains that the enquired property is unavailable and keeps the search active', async () => {
    const reply = await buildBuyerMatchReply({
      accountId: 'account',
      contactId: 'vinutha',
      db: dbForUnavailableEnquiry() as never,
    });

    expect(reply).toContain('*Palm Grove* is no longer available');
    expect(reply).toContain('kept your requirement active');
    expect(reply).not.toContain('nothing in our inventory fits');
  });
});

describe('buildBuyerMatchReplyWithListings', () => {
  it('names the listings the reply carries so the sender can record them', async () => {
    const reply = await buildBuyerMatchReplyWithListings({
      accountId: 'account',
      contactId: 'simon',
      db: dbForAvailableEnquiry() as never,
    });

    expect(reply?.text).toContain("Here's the property you enquired about");
    expect(reply?.propertyIds[0]).toBe('hebron');
    expect(reply?.propertyIds).toContain('alternative');
  });

  it('carries no listings when nothing fits', async () => {
    const reply = await buildBuyerMatchReplyWithListings({
      accountId: 'account',
      contactId: 'vinutha',
      db: dbForUnavailableEnquiry() as never,
    });

    expect(reply?.propertyIds).toEqual([]);
  });
});
