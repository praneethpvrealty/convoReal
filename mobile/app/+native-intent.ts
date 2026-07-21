/**
 * Deep-link rewriter (expo-router convention file).
 *
 * Incoming OS links — https://convoreal.com/... App Links,
 * convoreal:// scheme links, or Expo Go dev links — pass through
 * redirectSystemPath before routing. The web app addresses records
 * with QUERY params (?property_id=..., ?c=...), which don't map to
 * app routes by themselves, so translate the known shapes here.
 *
 * Returned paths are app routes with group segments stripped:
 * /(app)/property/[id] -> "/property/<id>".
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const url = new URL(path, 'https://convoreal.com');
    const q = url.searchParams;

    const propertyId = q.get('property_id') || q.get('propertyId');
    if (propertyId) return `/property/${propertyId}`;

    const contactId = q.get('contact_id') || q.get('contactId');
    if (contactId) return `/contact/${contactId}`;

    const conversationId = q.get('c') || q.get('conversation_id') || q.get('conversationId');
    if (conversationId) return `/conversation/${conversationId}`;

    // Path-style web pages -> nearest app screen.
    const p = url.pathname.replace(/\/+$/, '');
    if (p === '/inventory') return '/properties';
    if (p === '/pipelines') return '/deals';
    if (p === '/contacts') return '/contacts';
    if (p === '/calendar') return '/calendar';
    if (p === '/journey') return '/journey';
    if (p === '/broadcasts') return '/broadcasts';
    if (p === '/settings') return '/more';
    if (p === '' || p === '/' || p === '/dashboard') return '/';

    return '/';
  } catch {
    return '/';
  }
}
