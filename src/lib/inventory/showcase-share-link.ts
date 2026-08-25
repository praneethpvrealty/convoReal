export type ShareScope = 'all' | 'search' | 'pick';
export type ShareCategory = 'All' | 'Residential' | 'Commercial' | 'Agricultural';

export interface ShowcaseShareLinkOptions {
  /** Origin the showcase is served from, e.g. https://acme.convoreal.com */
  baseUrl: string;
  /** Appended as ?ref= when the account has no showcase subdomain. */
  accountId?: string | null;
  includeRef: boolean;
  scope: ShareScope;
  category?: ShareCategory;
  search?: string;
  /** property_code (or id) per hand-picked listing, in display order. */
  ids?: string[];
  audience: 'client' | 'agent';
  /** Contact id, so Showcase Pulse attributes the visit by name. */
  visitorId?: string;
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
}: ShowcaseShareLinkOptions): string {
  const url = new URL(baseUrl);

  if (includeRef && accountId) url.searchParams.set('ref', accountId);

  if (scope === 'search') {
    if (search.trim()) url.searchParams.set('search', search.trim());
  } else if (scope === 'pick') {
    if (ids.length > 0) url.searchParams.set('ids', ids.join(','));
  } else if (category !== 'All') {
    url.searchParams.set('category', category);
  }

  if (audience === 'agent') url.searchParams.set('mode', 'view');
  if (visitorId) url.searchParams.set('v', visitorId);

  return url.toString();
}
