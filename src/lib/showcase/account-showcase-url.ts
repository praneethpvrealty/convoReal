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
  showcaseOriginForHost,
  propertyShowcaseUrl,
  type ShowcaseLinkProperty,
} from '@/lib/share-message-builder';

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || BRANDING.websiteUrl).replace(/\/$/, '');
}

/**
 * The account's own subdomain, or null.
 *
 * It lives on `showcase_settings`, and only there — `accounts` has no
 * such column and never did. This helper used to select it from
 * `accounts`, which PostgREST answers with an error rather than a
 * throw, so `data` came back null, every account looked
 * subdomain-less, and every link this file produced was unbranded. The
 * one thing it exists to prevent.
 */
async function accountSubdomain(
  db: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('showcase_settings')
    .select('subdomain')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    console.error('[showcase-url] subdomain lookup failed:', error);
    return null;
  }
  const subdomain = (data?.subdomain as string | null) ?? null;
  return subdomain?.trim() ? subdomain.trim() : null;
}

/**
 * The account's own name, for signing a message it sends.
 *
 * A template that names nobody reaches a buyer who enquired weeks ago
 * as property details from an unrecognised number. Null falls back to
 * the product name at the param builder rather than sending unsigned.
 */
export async function accountBrandName(
  db: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from('accounts')
      .select('name')
      .eq('id', accountId)
      .maybeSingle();
    if (error) {
      console.error('[showcase-url] brand name lookup failed:', error);
      return null;
    }
    const name = (data?.name as string | null) ?? null;
    return name?.trim() ? name.trim() : null;
  } catch (err) {
    console.error('[showcase-url] brand name lookup threw:', err);
    return null;
  }
}

/**
 * The account's brand card, as a bucket-relative path, or null.
 *
 * A WhatsApp template's media header is filled at send time, so this
 * rides in an already-approved Utility template without touching its
 * category. It is what a message leads with when it has no photo of its
 * own — a listing with none uploaded yet, or anything that is not about
 * one listing.
 *
 * Never throws: a message with a plain header is a message, and losing
 * one over a missing decoration would be the worse trade.
 */
export async function accountBrandImage(
  db: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from('showcase_settings')
      .select('brand_image_url')
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) {
      console.error('[showcase-url] brand image lookup failed:', error);
      return null;
    }
    const url = (data?.brand_image_url as string | null) ?? null;
    return url?.trim() ? url.trim() : null;
  } catch (err) {
    console.error('[showcase-url] brand image lookup threw:', err);
    return null;
  }
}

/**
 * The account's showcase base as a full URL: its own subdomain when it
 * has one, otherwise the shared site carrying `?ref=<account>` so the
 * catalog still renders that brokerage's listings. Falls back to the
 * bare site on any lookup failure — a link that loads the wrong catalog
 * is worse than one that loads the default.
 */
export async function accountShowcaseBase(
  db: SupabaseClient,
  accountId: string,
): Promise<string> {
  try {
    return showcaseBaseUrl(
      siteUrl(),
      await accountSubdomain(db, accountId),
      accountId,
    );
  } catch {
    return siteUrl();
  }
}

/**
 * The account's showcase ORIGIN — subdomain when it has one, otherwise
 * the plain site. Never carries a query string, which is what separates
 * it from accountShowcaseBase.
 *
 * For anywhere a caller appends its own query: a WhatsApp URL button
 * takes its suffix as a template parameter (`?property_id=…&v=…`, see
 * share-property-send), so a base already ending in `?ref=<account>`
 * would compose into `…/?ref=x/?property_id=y` and resolve to nothing.
 * An account with no subdomain loses the `ref` here rather than the
 * link — the property id alone still finds the listing.
 */
export async function accountShowcaseOrigin(
  db: SupabaseClient,
  accountId: string,
): Promise<string> {
  try {
    const site = new URL(siteUrl());
    return showcaseOriginForHost(
      site.host,
      site.protocol,
      await accountSubdomain(db, accountId),
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
