import { describe, expect, it } from 'vitest';
import { buildBuyerMatchReply } from './match-reply';

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
          data: rows[table].find((row) =>
            Object.entries(filters).every(([column, value]) =>
              (row as Record<string, unknown>)[column] === value
            )
          ) || null,
        }),
        then(resolve: (value: { data: unknown[] }) => unknown) {
          return Promise.resolve({
            data: rows[table].filter((row) =>
              Object.entries(filters).every(([column, value]) =>
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

describe('buildBuyerMatchReply', () => {
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
