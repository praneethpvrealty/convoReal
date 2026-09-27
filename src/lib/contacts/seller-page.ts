import type { SupabaseClient } from '@supabase/supabase-js';
import {
  accountBrandName,
  accountShowcaseOrigin,
} from '@/lib/showcase/account-showcase-url';
import {
  generateSellerPageSlug,
  sellerPageUrl,
} from '@/lib/showcase/seller-page';

const MINT_ATTEMPTS = 3;
const UNIQUE_VIOLATION = '23505';

export interface SellerPageStatus {
  enabled: boolean;
  url: string | null;
  listing_count: number;
  owns_listings: boolean;
  share_message: string | null;
}

export function sellerPageShareMessage(
  agencyName: string | null,
  url: string
): string {
  const agency = agencyName?.trim() || 'us';
  return `Here is your own page with all your listings on ${agency}. Share it with anyone who may be interested — every enquiry comes straight to us.\n\n${url}`;
}

export class SellerPageContactNotFoundError extends Error {
  constructor() {
    super('Contact not found');
    this.name = 'SellerPageContactNotFoundError';
  }
}

async function contactSlug(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<string | null> {
  const { data, error } = await db
    .from('contacts')
    .select('id, seller_page_slug')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new SellerPageContactNotFoundError();
  return (data.seller_page_slug as string | null) ?? null;
}

async function ownedListings(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<{ live: number; owned: number }> {
  const { data, error } = await db
    .from('properties')
    .select('is_published')
    .eq('account_id', accountId)
    .eq('owner_contact_id', contactId)
    .neq('listing_source', 'agent');
  if (error) throw error;
  const rows = (data ?? []) as Array<{ is_published: boolean | null }>;
  return {
    owned: rows.length,
    live: rows.filter((row) => row.is_published === true).length,
  };
}

async function urlFor(
  db: SupabaseClient,
  accountId: string,
  slug: string | null
): Promise<string | null> {
  if (!slug) return null;
  return sellerPageUrl(await accountShowcaseOrigin(db, accountId), slug);
}

export async function getSellerPageStatus(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<SellerPageStatus> {
  const slug = await contactSlug(db, accountId, contactId);
  const [listings, url] = await Promise.all([
    ownedListings(db, accountId, contactId),
    urlFor(db, accountId, slug),
  ]);
  return {
    enabled: Boolean(slug),
    url,
    listing_count: listings.live,
    owns_listings: listings.owned > 0,
    share_message: url
      ? sellerPageShareMessage(await accountBrandName(db, accountId), url)
      : null,
  };
}

export async function enableSellerPage(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  options: { rotate?: boolean } = {}
): Promise<SellerPageStatus> {
  const current = await contactSlug(db, accountId, contactId);
  if (current && !options.rotate) {
    return getSellerPageStatus(db, accountId, contactId);
  }
  for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
    const { error } = await db
      .from('contacts')
      .update({ seller_page_slug: generateSellerPageSlug() })
      .eq('id', contactId)
      .eq('account_id', accountId);
    if (!error) return getSellerPageStatus(db, accountId, contactId);
    if (error.code !== UNIQUE_VIOLATION) throw error;
  }
  throw new Error('Could not create a unique seller page link');
}

export async function disableSellerPage(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<SellerPageStatus> {
  await contactSlug(db, accountId, contactId);
  const { error } = await db
    .from('contacts')
    .update({ seller_page_slug: null })
    .eq('id', contactId)
    .eq('account_id', accountId);
  if (error) throw error;
  return getSellerPageStatus(db, accountId, contactId);
}
