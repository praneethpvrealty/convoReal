// Server-side showcase links for an account, by account id.
//
// The manual share paths build links through showcaseBaseUrl(), so a
// brokerage with a subdomain gets `https://<them>.convoreal.com/…` and
// the listing is addressed by its property code. The bot paths built
// links straight from NEXT_PUBLIC_SITE_URL with a raw UUID instead, so
// the same listing reached the same lead as an unbranded
// `https://convoreal.com/?property_id=<uuid>`. One helper so both
// sides agree.

import type { SupabaseClient } from '@supabase/supabase-js';
import { BRANDING } from '@/config/branding';
import {
  showcaseBaseUrl,
  propertyShowcaseUrl,
  type ShowcaseLinkProperty,
} from '@/lib/share-message-builder';

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || BRANDING.websiteUrl).replace(/\/$/, '');
}

/**
 * The account's showcase origin: its own subdomain when it has one,
 * otherwise the shared site carrying `?ref=<account>` so the catalog
 * still renders that brokerage's listings. Falls back to the bare site
 * on any lookup failure — a link that loads the wrong catalog is worse
 * than one that loads the default.
 */
export async function accountShowcaseBase(
  db: SupabaseClient,
  accountId: string,
): Promise<string> {
  try {
    const { data } = await db
      .from('accounts')
      .select('subdomain')
      .eq('id', accountId)
      .maybeSingle();
    return showcaseBaseUrl(
      siteUrl(),
      (data?.subdomain as string | null) ?? null,
      accountId,
    );
  } catch {
    return siteUrl();
  }
}

/**
 * A property link on the account's showcase, attributed to the contact
 * that received it. `v=` names the visitor in Showcase Pulse and never
 * filters the catalog.
 */
export async function accountPropertyShowcaseUrl(
  db: SupabaseClient,
  accountId: string,
  property: ShowcaseLinkProperty,
  visitorContactId?: string | null,
): Promise<string> {
  const base = await accountShowcaseBase(db, accountId);
  const url = propertyShowcaseUrl(base, property);
  return visitorContactId
    ? `${url}&v=${encodeURIComponent(visitorContactId)}`
    : url;
}
