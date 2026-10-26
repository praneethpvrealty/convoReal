export const INTERNAL_VIEW_PARAM = 'internal';

export function markInternalView(url: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${INTERNAL_VIEW_PARAM}=1`;
}

export function isInternalView(search: string): boolean {
  return new URLSearchParams(search).get(INTERNAL_VIEW_PARAM) === '1';
}
