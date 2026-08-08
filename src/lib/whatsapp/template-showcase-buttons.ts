// ============================================================
// Point a template's URL buttons at the brokerage's own showcase.
//
// The engine-template builders take an `origin` and every caller is a
// client component, so the only origin any of them could pass was
// `window.location.origin` — the DASHBOARD's host. An account with its
// own subdomain therefore submitted a "View full details" button
// pointing at the shared site, and a buyer who tapped it landed on the
// default showcase instead of the brokerage's.
//
// The account is known on the server and nowhere in the client, so the
// substitution belongs at submission: one place, every template.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { accountShowcaseOrigin } from '@/lib/showcase/account-showcase-url';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';

type TemplateButton = NonNullable<TemplatePayload['buttons']>[number];

/**
 * Swaps the origin of a URL button for the account's showcase origin,
 * keeping the path and the `{{n}}` placeholder exactly as submitted.
 *
 * Only the origin moves. The suffix is what the send fills in — the
 * button's parameter arrives as `?property_id=…&v=…` — so rewriting
 * anything past the host would break the very link this is fixing.
 *
 * Left alone when the URL is not parseable or points somewhere else
 * entirely: a template deliberately linking to a portal, a RERA page or
 * a partner site is not ours to redirect.
 */
export function withShowcaseOrigin(
  url: string,
  showcaseOrigin: string,
  appOrigins: string[],
): string {
  const placeholder = /\{\{\d+\}\}/.exec(url)?.[0] ?? '';
  const withoutPlaceholder = placeholder ? url.replace(placeholder, '') : url;

  let parsed: URL;
  try {
    parsed = new URL(withoutPlaceholder);
  } catch {
    return url;
  }

  const hosts = new Set<string>();
  for (const origin of appOrigins) {
    try {
      hosts.add(new URL(origin).host);
    } catch {
      // A malformed configured origin is not a reason to rewrite
      // nothing; the others still match.
    }
  }
  if (!hosts.has(parsed.host)) return url;

  const target = showcaseOrigin.replace(/\/+$/, '');
  const path = parsed.pathname === '/' ? '/' : parsed.pathname;
  return `${target}${path}${parsed.search}${placeholder}`;
}

/**
 * The payload as it should reach Meta: URL buttons on the account's own
 * showcase.
 *
 * Never throws — a lookup failure leaves the payload exactly as
 * submitted, which is today's behaviour, rather than failing a
 * submission over a cosmetic host.
 */
export async function withAccountShowcaseButtons(
  db: SupabaseClient,
  accountId: string,
  payload: TemplatePayload,
): Promise<TemplatePayload> {
  const buttons = payload.buttons;
  if (!buttons?.length) return payload;
  if (!buttons.some((b) => b.type === 'URL' && typeof b.url === 'string')) {
    return payload;
  }

  try {
    const showcaseOrigin = await accountShowcaseOrigin(db, accountId);
    const appOrigins = [
      process.env.NEXT_PUBLIC_SITE_URL,
      process.env.NEXT_PUBLIC_APP_URL,
    ].filter((o): o is string => !!o);

    return {
      ...payload,
      buttons: buttons.map((button: TemplateButton) =>
        button.type === 'URL' && typeof button.url === 'string'
          ? { ...button, url: withShowcaseOrigin(button.url, showcaseOrigin, appOrigins) }
          : button,
      ),
    };
  } catch (err) {
    console.error('[template-showcase-buttons] rewrite failed:', err);
    return payload;
  }
}
