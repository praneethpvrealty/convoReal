// Showcase share scoping — the param rules one catalog link is built
// from. Port of the web's src/lib/inventory/showcase-share-link.ts, so a
// link built on the phone opens exactly what the same choices open from
// the desktop. Ported rather than imported: `@shared/` resolves types
// only here. src/lib/mobile-parity.test.ts pins the param names and
// their precedence.

function withParam(baseUrl: string, key: string, value: string): string {
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}${key}=${encodeURIComponent(value)}`;
}

// Port of the web's src/lib/inventory/showcase-share-link.ts param
// rules, so a link built on the phone opens exactly what the same
// choices open from the desktop. Ported rather than imported: `@shared/`
// resolves types only here. src/lib/mobile-parity.test.ts pins the
// param names and their precedence.

export type ShareScope = 'all' | 'search' | 'pick';
export type ShareCategory =
  | 'All'
  | 'Residential'
  | 'Commercial'
  | 'Agricultural';

export interface ShowcaseScopeOptions {
  scope: ShareScope;
  category?: ShareCategory;
  search?: string;
  /** property_code (or id) per hand-picked listing, in display order. */
  ids?: readonly string[];
  audience: 'client' | 'agent';
  visitorId?: string;
}

/** Applies one share scope to a showcase base URL from getShowcaseUrl(). */
export function applyShowcaseScope(
  baseUrl: string,
  {
    scope,
    category = 'All',
    search = '',
    ids = [],
    audience,
    visitorId,
  }: ShowcaseScopeOptions
): string {
  let url = baseUrl;

  if (scope === 'search') {
    if (search.trim()) url = withParam(url, 'search', search.trim());
  } else if (scope === 'pick') {
    if (ids.length > 0) url = withParam(url, 'ids', ids.join(','));
  } else if (category !== 'All') {
    url = withParam(url, 'category', category);
  }

  if (audience === 'agent') url = withParam(url, 'mode', 'view');
  if (visitorId) url = withParam(url, 'v', visitorId);

  return url;
}


/** Tags any showcase link with the contact it is being sent to, so
 *  Pulse attributes their opens by name (v= attributes, never filters). */
export function withShowcaseVisitor(url: string, contactId: string): string {
  return withParam(url, 'v', contactId);
}
