import type { SupabaseClient } from '@supabase/supabase-js';
import type { DenContactLink } from '@/lib/den/auth';
import { accountShowcaseOrigin } from '@/lib/showcase/account-showcase-url';
import { isSellerPageSlug, sellerPageUrl } from '@/lib/showcase/seller-page';

export interface DenSellerPage {
  account_id: string;
  agency_name: string | null;
  url: string | null;
  share_message: string | null;
}

export function sellerPageForwardMessage(
  agencyName: string | null,
  url: string
): string {
  const agency = agencyName?.trim();
  return agency
    ? `Have a look at the properties I have listed with ${agency}:\n${url}`
    : `Have a look at the properties I have listed:\n${url}`;
}

export async function denSellerPages(
  db: SupabaseClient,
  links: DenContactLink[]
): Promise<DenSellerPage[]> {
  if (links.length === 0) return [];
  const { data, error } = await db
    .from('contacts')
    .select('id, account_id, seller_page_slug')
    .in(
      'id',
      links.map((link) => link.contactId)
    );
  if (error) {
    console.error('[den/seller-pages] lookup failed:', error.message);
    return [];
  }
  const slugByContact = new Map(
    (
      (data ?? []) as Array<{
        id: string;
        account_id: string;
        seller_page_slug: string | null;
      }>
    )
      .filter((row) => isSellerPageSlug(row.seller_page_slug))
      .map((row) => [`${row.account_id}:${row.id}`, row.seller_page_slug!])
  );
  const pages = await Promise.all(
    links.map(async (link): Promise<DenSellerPage> => {
      const slug = slugByContact.get(`${link.accountId}:${link.contactId}`);
      const url = slug
        ? sellerPageUrl(await accountShowcaseOrigin(db, link.accountId), slug)
        : null;
      return {
        account_id: link.accountId,
        agency_name: link.agencyName,
        url,
        share_message: url
          ? sellerPageForwardMessage(link.agencyName, url)
          : null,
      };
    })
  );
  const byAccount = new Map<string, DenSellerPage[]>();
  for (const page of pages) {
    const group = byAccount.get(page.account_id) ?? [];
    if (!group.some((existing) => existing.url === page.url)) group.push(page);
    byAccount.set(page.account_id, group);
  }
  return [...byAccount.values()].flatMap((group) => {
    const live = group.filter((page) => page.url);
    return live.length > 0 ? live : group.slice(0, 1);
  });
}
