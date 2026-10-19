export type ShareScope = 'all' | 'search' | 'pick';
export type ShareCategory =
  'All' | 'Residential' | 'Commercial' | 'Agricultural';

export interface ShowcaseShareLinkOptions {
  /** Origin the showcase is served from, e.g. https://acme.convoreal.com */
  baseUrl: string;
  /** Appended as ?ref= when the account has no showcase subdomain. */
  accountId?: string | null;
  includeRef: boolean;
  scope: ShareScope;
  category?: ShareCategory;
  search?: string;
  /** property_code (or id) per resolved or hand-picked listing, in display order. */
  ids?: string[];
  audience: 'client' | 'agent';
  /** Contact id, so Showcase Pulse attributes the visit by name. */
  visitorId?: string;
  /** Share-instance token (?s=). When the share was minted with the
   *  pinned ids, the link carries the token in their place. */
  shareId?: string | null;
}

export function buildShowcaseShareLink({
  baseUrl,
  accountId,
  includeRef,
  scope,
  category = 'All',
  search = '',
  ids = [],
  audience,
  visitorId,
  shareId,
}: ShowcaseShareLinkOptions): string {
  const url = new URL(baseUrl);

  if (includeRef && accountId) url.searchParams.set('ref', accountId);

  if (scope === 'search') {
    if (ids.length > 0) {
      if (!shareId) url.searchParams.set('ids', ids.join(','));
    } else if (search.trim()) url.searchParams.set('search', search.trim());
  } else if (scope === 'pick') {
    if (ids.length > 0 && !shareId) url.searchParams.set('ids', ids.join(','));
  } else if (category !== 'All') {
    url.searchParams.set('category', category);
  }

  if (audience === 'agent') url.searchParams.set('mode', 'view');
  if (shareId) url.searchParams.set('s', shareId);
  if (visitorId) url.searchParams.set('v', visitorId);

  return url.toString();
}
