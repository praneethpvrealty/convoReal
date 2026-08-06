import {
  propertyShowcaseUrl,
  showcaseBaseUrl,
  type ShareAudience,
} from '@/lib/share-message';
import type { Property } from '@/lib/types';

/**
 * The showcase link a share carries. It must sit on the account's own
 * subdomain (`aryavartaventures.convoreal.com`) exactly like the web
 * dialog's, and fall back to `?ref=<account>` on the shared domain when
 * the account has no subdomain — a bare link scopes the catalog to
 * nobody, and property codes repeat across accounts.
 *
 * A co-broker ('agent') gets the clean view-only page.
 */
export function propertyShareUrl(input: {
  siteUrl: string;
  subdomain: string | null;
  accountId: string | null;
  property: Property;
  audience: ShareAudience;
}): string {
  const base = showcaseBaseUrl(input.siteUrl, input.subdomain, input.accountId);
  const url = propertyShowcaseUrl(base, input.property);
  return input.audience === 'agent' ? `${url}&mode=view` : url;
}
