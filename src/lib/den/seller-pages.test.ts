import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DenContactLink } from '@/lib/den/auth';

vi.mock('@/lib/showcase/account-showcase-url', () => ({
  accountShowcaseOrigin: async (_db: unknown, accountId: string) =>
    accountId === 'acct-a'
      ? 'https://acme.convoreal.com'
      : 'https://www.convoreal.com',
}));

const { denSellerPages, sellerPageForwardMessage } =
  await import('./seller-pages');

type LinkRow = {
  den_user_id: string;
  status: string;
  account_id: string;
  contact_id: string;
  contact: { account_id: string; seller_page_slug: string | null } | null;
};

function db(rows: LinkRow[]) {
  const queries: Array<{ table: string; filters: Array<[string, string]> }> =
    [];
  const client = {
    from: (table: string) => {
      const query = { table, filters: [] as Array<[string, string]> };
      queries.push(query);
      const builder = {
        select: () => builder,
        in: () => {
          throw new Error('seller pages must not send an id list');
        },
        eq: (column: string, value: string) => {
          query.filters.push([column, value]);
          return builder;
        },
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({
            data: rows.filter((row) =>
              query.filters.every(
                ([column, value]) => row[column as keyof LinkRow] === value
              )
            ),
            error: null,
          }).then(resolve),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, queries };
}

const link = (
  contactId: string,
  accountId: string,
  agencyName: string | null
): DenContactLink => ({
  linkId: `l-${contactId}`,
  accountId,
  contactId,
  agencyName,
});

const row = (
  contactId: string,
  accountId: string,
  slug: string | null,
  contactAccount = accountId
): LinkRow => ({
  den_user_id: 'den-1',
  status: 'active',
  account_id: accountId,
  contact_id: contactId,
  contact: { account_id: contactAccount, seller_page_slug: slug },
});

describe('denSellerPages', () => {
  it('[SLP-006] returns a live link per agency and a placeholder where the agency has not turned it on', async () => {
    const { client, queries } = db([
      row('c1', 'acct-a', 'bcdfghjkmn'),
      row('c2', 'acct-b', null),
    ]);
    const pages = await denSellerPages(client, 'den-1', [
      link('c1', 'acct-a', 'Acme Realty'),
      link('c2', 'acct-b', 'Beta Homes'),
    ]);
    expect(queries).toEqual([
      {
        table: 'den_contact_links',
        filters: [
          ['den_user_id', 'den-1'],
          ['status', 'active'],
        ],
      },
    ]);
    expect(pages).toEqual([
      {
        account_id: 'acct-a',
        agency_name: 'Acme Realty',
        url: 'https://acme.convoreal.com/seller/bcdfghjkmn',
        share_message: sellerPageForwardMessage(
          'Acme Realty',
          'https://acme.convoreal.com/seller/bcdfghjkmn'
        ),
      },
      {
        account_id: 'acct-b',
        agency_name: 'Beta Homes',
        url: null,
        share_message: null,
      },
    ]);
  });

  it('hides an off contact when another contact at the same agency has a page', async () => {
    const { client } = db([
      row('c1', 'acct-a', null),
      row('c2', 'acct-a', 'pqrstvwxyz'),
    ]);
    const pages = await denSellerPages(client, 'den-1', [
      link('c1', 'acct-a', 'Acme Realty'),
      link('c2', 'acct-a', 'Acme Realty'),
    ]);
    expect(pages.map((page) => page.url)).toEqual([
      'https://acme.convoreal.com/seller/pqrstvwxyz',
    ]);
  });

  it('never pairs a slug with a link whose contact belongs to another account', async () => {
    const { client } = db([row('c1', 'acct-a', 'bcdfghjkmn', 'acct-b')]);
    const pages = await denSellerPages(client, 'den-1', [
      link('c1', 'acct-a', 'Acme Realty'),
    ]);
    expect(pages[0].url).toBeNull();
  });

  it('ignores links belonging to another Portfolio user', async () => {
    const { client } = db([
      { ...row('c1', 'acct-a', 'bcdfghjkmn'), den_user_id: 'den-2' },
    ]);
    const pages = await denSellerPages(client, 'den-1', [
      link('c1', 'acct-a', 'Acme Realty'),
    ]);
    expect(pages[0].url).toBeNull();
  });

  it('asks nothing of the database without links', async () => {
    const { client, queries } = db([]);
    await expect(denSellerPages(client, 'den-1', [])).resolves.toEqual([]);
    expect(queries).toEqual([]);
  });
});
