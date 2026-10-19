/**
 * The scope rule one showcase share link is built from, shared at
 * runtime by web and mobile. The mobile app bundles this file through
 * `@shared/`, so it must stay free of imports — mobile/metro.config.js
 * refuses any that are not relative, and src/lib/mobile-parity.test.ts
 * checks the same from the web side.
 */

export type ShareScope = 'all' | 'search' | 'pick';
export type ShareCategory =
  'All' | 'Residential' | 'Commercial' | 'Agricultural';

export interface ShowcaseScopeOptions {
  scope: ShareScope;
  category?: ShareCategory;
  search?: string;
  /** property_code (or id) per resolved or hand-picked listing, in display order. */
  ids?: readonly string[];
  audience: 'client' | 'agent';
  /** Contact id, so Showcase Pulse attributes the visit by name. */
  visitorId?: string;
  /** Share-instance token (?s=). When the share was minted with the
   *  pinned ids, the link carries the token in their place. */
  shareId?: string | null;
}

/** The query params one share scope adds to a showcase link, in order:
 *  search wins over pick wins over category, then the co-broker mode,
 *  the share token and the named visitor. */
export function showcaseScopeParams({
  scope,
  category = 'All',
  search = '',
  ids = [],
  audience,
  visitorId,
  shareId,
}: ShowcaseScopeOptions): Array<[string, string]> {
  const params: Array<[string, string]> = [];

  if (scope === 'search') {
    if (ids.length > 0) {
      if (!shareId) params.push(['ids', ids.join(',')]);
    } else if (search.trim()) params.push(['search', search.trim()]);
  } else if (scope === 'pick') {
    if (ids.length > 0 && !shareId) params.push(['ids', ids.join(',')]);
  } else if (category !== 'All') {
    params.push(['category', category]);
  }

  if (audience === 'agent') params.push(['mode', 'view']);
  if (shareId) params.push(['s', shareId]);
  if (visitorId) params.push(['v', visitorId]);

  return params;
}

function withParam(baseUrl: string, key: string, value: string): string {
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}${key}=${encodeURIComponent(value)}`;
}

/** Applies one share scope to a showcase base URL that may already
 *  carry a query (the mobile getShowcaseUrl() appends ?ref=). */
export function applyShowcaseScope(
  baseUrl: string,
  options: ShowcaseScopeOptions
): string {
  return showcaseScopeParams(options).reduce(
    (url, [key, value]) => withParam(url, key, value),
    baseUrl
  );
}

/** Tags any showcase link with the contact it is being sent to, so
 *  Pulse attributes their opens by name (v= attributes, never filters). */
export function withShowcaseVisitor(url: string, contactId: string): string {
  return withParam(url, 'v', contactId);
}
