import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SELLER_PAGE_SLUG_ALPHABET,
  SELLER_PAGE_SLUG_LENGTH,
  filterSellerListings,
  generateSellerPageSlug,
  isSellerPageSlug,
  resolveSellerPage,
  sellerPageUrl,
} from './seller-page';

interface Row {
  id: string;
  account_id: string;
  seller_page_slug: string | null;
}

function contactsDb(rows: Row[], failWith?: string) {
  const calls: Array<[string, string]> = [];
  const db = {
    from(table: string) {
      expect(table).toBe('contacts');
      const filters: Array<[string, string]> = [];
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: string) {
          filters.push([column, value]);
          calls.push([column, value]);
          return builder;
        },
        maybeSingle() {
          if (failWith) {
            return Promise.resolve({
              data: null,
              error: { message: failWith },
            });
          }
          const match = rows.find((row) =>
            filters.every(
              ([column, value]) => row[column as keyof Row] === value
            )
          );
          return Promise.resolve({ data: match ?? null, error: null });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

describe('generateSellerPageSlug', () => {
  it('draws only from the unambiguous alphabet at the fixed length', () => {
    for (let i = 0; i < 200; i++) {
      const slug = generateSellerPageSlug();
      expect(slug).toHaveLength(SELLER_PAGE_SLUG_LENGTH);
      for (const char of slug) {
        expect(SELLER_PAGE_SLUG_ALPHABET).toContain(char);
      }
      expect(isSellerPageSlug(slug)).toBe(true);
    }
  });

  it('never repeats across a large draw', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(generateSellerPageSlug());
    expect(seen.size).toBe(2000);
  });
});

describe('isSellerPageSlug', () => {
  it('rejects uuids, wrong lengths, vowels, look-alikes and non-strings', () => {
    expect(isSellerPageSlug('3f1c2d4e-0000-4000-8000-000000000000')).toBe(
      false
    );
    expect(isSellerPageSlug('bcdfghjkm')).toBe(false);
    expect(isSellerPageSlug('bcdfghjkmnp')).toBe(false);
    expect(isSellerPageSlug('bcdfghjkma')).toBe(false);
    expect(isSellerPageSlug('bcdfghjkm0')).toBe(false);
    expect(isSellerPageSlug('bcdfghjkml')).toBe(false);
    expect(isSellerPageSlug('BCDFGHJKMN')).toBe(false);
    expect(isSellerPageSlug(undefined)).toBe(false);
    expect(isSellerPageSlug(42)).toBe(false);
  });
});

describe('sellerPageUrl', () => {
  it('appends the seller path to the origin without doubling slashes', () => {
    expect(sellerPageUrl('https://acme.convoreal.com/', 'bcdfghjkmn')).toBe(
      'https://acme.convoreal.com/seller/bcdfghjkmn'
    );
    expect(sellerPageUrl('https://www.convoreal.com', 'bcdfghjkmn')).toBe(
      'https://www.convoreal.com/seller/bcdfghjkmn'
    );
  });
});

describe('filterSellerListings', () => {
  it('[SLP-001] keeps only the seller’s own listings and drops agent-referred rows', () => {
    const listings = [
      {
        id: 'own',
        owner_contact_id: 'seller',
        listing_source: 'owner' as const,
      },
      {
        id: 'wa',
        owner_contact_id: 'seller',
        listing_source: 'whatsapp_lister' as const,
      },
      { id: 'legacy', owner_contact_id: 'seller', listing_source: undefined },
      {
        id: 'cobroke',
        owner_contact_id: 'seller',
        listing_source: 'agent' as const,
      },
      {
        id: 'other',
        owner_contact_id: 'someone-else',
        listing_source: 'owner' as const,
      },
      { id: 'none', owner_contact_id: null, listing_source: 'owner' as const },
    ];
    expect(filterSellerListings(listings, 'seller').map((l) => l.id)).toEqual([
      'own',
      'wa',
      'legacy',
    ]);
  });

  it('[SLP-001] returns an empty list rather than the catalogue when the seller has nothing live', () => {
    const listings = [
      { id: 'a', owner_contact_id: 'other', listing_source: 'owner' as const },
    ];
    expect(filterSellerListings(listings, 'seller')).toEqual([]);
  });
});

describe('resolveSellerPage', () => {
  const rows: Row[] = [
    { id: 'contact-1', account_id: 'acct-1', seller_page_slug: 'bcdfghjkmn' },
  ];

  it('resolves a live slug to its account and contact', async () => {
    const { db } = contactsDb(rows);
    await expect(resolveSellerPage(db, 'bcdfghjkmn')).resolves.toEqual({
      accountId: 'acct-1',
      contactId: 'contact-1',
    });
  });

  it('[SLP-003] returns null for a slug that was rotated or turned off', async () => {
    const { db } = contactsDb(rows);
    await expect(resolveSellerPage(db, 'pqrstvwxyz')).resolves.toBeNull();
  });

  it('never queries for a malformed slug', async () => {
    const { db, calls } = contactsDb(rows);
    await expect(resolveSellerPage(db, "x' or 1=1")).resolves.toBeNull();
    expect(calls).toEqual([]);
  });

  it('scopes to the account when one is given', async () => {
    const { db, calls } = contactsDb(rows);
    await expect(
      resolveSellerPage(db, 'bcdfghjkmn', 'acct-2')
    ).resolves.toBeNull();
    expect(calls).toContainEqual(['account_id', 'acct-2']);
  });

  it('treats a lookup error as no page', async () => {
    const { db } = contactsDb(rows, 'boom');
    await expect(resolveSellerPage(db, 'bcdfghjkmn')).resolves.toBeNull();
  });
});
