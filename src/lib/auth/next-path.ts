const BASE = 'http://next-path.invalid';

export function safeNextPath(
  next: string | null | undefined,
  fallback: string,
  within?: string
): string {
  if (!next || !next.startsWith('/')) return fallback;

  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE || url.pathname.startsWith('//')) return fallback;
  if (
    within &&
    url.pathname !== within &&
    !url.pathname.startsWith(`${within}/`)
  ) {
    return fallback;
  }

  return `${url.pathname}${url.search}${url.hash}`;
}
