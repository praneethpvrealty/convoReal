// ============================================================
// Buyer portal — listings an agent shared from the contact record.
//
// A hand-picked share to a buyer is recorded on the property share
// ledger like every other send, and mirrored into the buyer's Portfolio
// shortlist as source 'shared' so the buyer can manage it from their own
// account. A buyer who has not signed in yet gets the same rows on their
// first login, when completeBuyerAuth seeds the shortlist from the ledger
// (src/lib/buyer/linking.ts).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { BRANDING } from '@/config/branding';

export const MAX_SHARED_LISTINGS = 25;

export function portfolioLoginUrl(): string {
  const base = (
    process.env.NEXT_PUBLIC_SITE_URL || BRANDING.websiteUrl
  ).replace(/\/$/, '');
  return `${base}/buyer/login`;
}

export function buildPortfolioNudge(args: {
  linked: boolean;
  url: string;
  count: number;
}): string {
  const these = args.count === 1 ? 'This one is' : 'These are';
  return args.linked
    ? `${these} saved in your Portfolio too — open it any time to compare, keep or drop them, and tell me which ones to line up:\n${args.url}`
    : `${these} saved to your Portfolio as well — sign in with this WhatsApp number to keep track of them, compare, and tell me which ones to line up:\n${args.url}`;
}

export interface SharedShortlistLink {
  buyerUserId: string;
  accountId: string;
  contactId: string;
}

export interface SharedListingRef {
  contactId: string;
  propertyId: string;
}

export function sharedShortlistRows(
  links: SharedShortlistLink[],
  shares: SharedListingRef[]
): Array<{
  buyer_user_id: string;
  account_id: string;
  property_id: string;
  contact_id: string;
  source: 'shared';
}> {
  const byContact = new Map(links.map((link) => [link.contactId, link]));
  const seen = new Set<string>();
  const rows: ReturnType<typeof sharedShortlistRows> = [];
  for (const share of shares) {
    const link = byContact.get(share.contactId);
    if (!link) continue;
    const key = `${link.buyerUserId}:${share.propertyId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      buyer_user_id: link.buyerUserId,
      account_id: link.accountId,
      property_id: share.propertyId,
      contact_id: share.contactId,
      source: 'shared',
    });
  }
  return rows;
}

async function activeLinks(
  db: SupabaseClient,
  accountId: string,
  contactIds: string[]
): Promise<SharedShortlistLink[]> {
  if (contactIds.length === 0) return [];
  const { data, error } = await db
    .from('buyer_contact_links')
    .select('buyer_user_id, account_id, contact_id')
    .eq('account_id', accountId)
    .eq('status', 'active')
    .in('contact_id', contactIds);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    buyerUserId: row.buyer_user_id as string,
    accountId: row.account_id as string,
    contactId: row.contact_id as string,
  }));
}

export async function isPortfolioLinked(
  db: SupabaseClient,
  args: { accountId: string; contactId: string }
): Promise<boolean> {
  const links = await activeLinks(db, args.accountId, [args.contactId]);
  return links.length > 0;
}

export async function mirrorSharedListingsToPortfolio(
  db: SupabaseClient,
  args: { accountId: string; contactId: string; propertyIds: string[] }
): Promise<{ linked: boolean; saved: number }> {
  const links = await activeLinks(db, args.accountId, [args.contactId]);
  if (links.length === 0) return { linked: false, saved: 0 };
  const rows = sharedShortlistRows(
    links,
    args.propertyIds.map((propertyId) => ({
      contactId: args.contactId,
      propertyId,
    }))
  );
  if (rows.length === 0) return { linked: true, saved: 0 };
  const { data, error } = await db
    .from('buyer_shortlist_items')
    .upsert(rows, {
      onConflict: 'buyer_user_id,property_id',
      ignoreDuplicates: true,
    })
    .select('id');
  if (error) throw error;
  return { linked: true, saved: (data ?? []).length };
}
