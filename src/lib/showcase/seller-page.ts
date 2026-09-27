import { randomInt } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Property } from '@/types';

export const SELLER_PAGE_SLUG_ALPHABET = 'bcdfghjkmnpqrstvwxyz23456789';
export const SELLER_PAGE_SLUG_LENGTH = 10;

const SELLER_PAGE_SLUG_RE = new RegExp(
  `^[${SELLER_PAGE_SLUG_ALPHABET}]{${SELLER_PAGE_SLUG_LENGTH}}$`
);

export interface SellerPageTarget {
  accountId: string;
  contactId: string;
}

type SellerListingFields = Pick<
  Property,
  'owner_contact_id' | 'listing_source'
>;

export function generateSellerPageSlug(): string {
  let slug = '';
  for (let i = 0; i < SELLER_PAGE_SLUG_LENGTH; i++) {
    slug +=
      SELLER_PAGE_SLUG_ALPHABET[randomInt(SELLER_PAGE_SLUG_ALPHABET.length)];
  }
  return slug;
}

export function isSellerPageSlug(value: unknown): value is string {
  return typeof value === 'string' && SELLER_PAGE_SLUG_RE.test(value);
}

export function sellerPageUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/+$/, '')}/seller/${slug}`;
}

export function isSellerListing(
  listing: SellerListingFields,
  contactId: string
): boolean {
  return (
    listing.owner_contact_id === contactId && listing.listing_source !== 'agent'
  );
}

export function filterSellerListings<T extends SellerListingFields>(
  listings: T[],
  contactId: string
): T[] {
  return listings.filter((listing) => isSellerListing(listing, contactId));
}

export async function resolveSellerPage(
  db: SupabaseClient,
  slug: unknown,
  accountId?: string | null
): Promise<SellerPageTarget | null> {
  if (!isSellerPageSlug(slug)) return null;
  let query = db
    .from('contacts')
    .select('id, account_id')
    .eq('seller_page_slug', slug);
  if (accountId) query = query.eq('account_id', accountId);
  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error('[seller-page] resolve failed:', error.message);
    return null;
  }
  if (!data) return null;
  return {
    accountId: data.account_id as string,
    contactId: data.id as string,
  };
}
