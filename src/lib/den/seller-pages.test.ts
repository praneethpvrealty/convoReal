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

type Row = { id: string; account_id: string; seller_page_slug: string | null };

function db(rows: Row[]) {
  const requested: string[][] = [];
  const client = {
    from: () => ({
      select: () => ({
        in: (_column: string, ids: string[]) => {
          requested.push(ids);
          return Promise.resolve({
            data: rows.filter((row) => ids.includes(row.id)),
            error: null,
          });
        },
      }),
    }),
  } as unknown as SupabaseClient;
  return { client, requested };
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

describe('denSellerPages', () => {
  it('[SLP-006] returns a live link per agency and a placeholder where the agency has not turned it on', async () => {
    const { client, requested } = db([
      { id: 'c1', account_id: 'acct-a', seller_page_slug: 'bcdfghjkmn' },
      { id: 'c2', account_id: 'acct-b', seller_page_slug: null },
    ]);
    const pages = await denSellerPages(client, [
      link('c1', 'acct-a', 'Acme Realty'),
      link('c2', 'acct-b', 'Beta Homes'),
    ]);
    expect(requested).toEqual([['c1', 'c2']]);
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
      { id: 'c1', account_id: 'acct-a', seller_page_slug: null },
      { id: 'c2', account_id: 'acct-a', seller_page_slug: 'pqrstvwxyz' },
    ]);
    const pages = await denSellerPages(client, [
      link('c1', 'acct-a', 'Acme Realty'),
      link('c2', 'acct-a', 'Acme Realty'),
    ]);
    expect(pages.map((page) => page.url)).toEqual([
      'https://acme.convoreal.com/seller/pqrstvwxyz',
    ]);
  });

  it('never pairs a slug with a link from a different account', async () => {
    const { client } = db([
      { id: 'c1', account_id: 'acct-b', seller_page_slug: 'bcdfghjkmn' },
    ]);
    const pages = await denSellerPages(client, [
      link('c1', 'acct-a', 'Acme Realty'),
    ]);
    expect(pages[0].url).toBeNull();
  });

  it('asks nothing of the database without links', async () => {
    const { client, requested } = db([]);
    await expect(denSellerPages(client, [])).resolves.toEqual([]);
    expect(requested).toEqual([]);
  });
});
