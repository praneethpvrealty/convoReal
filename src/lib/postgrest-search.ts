/**
 * Search terms for PostgREST `.or()` expressions, shared by the web API
 * and the mobile app through `@shared/`, so it must stay free of imports.
 */

/**
 * Escape a user string for use inside a PostgREST `.or()` expression.
 *
 * `.or()` takes a comma-separated filter list with parenthesised
 * groups, so an unescaped comma or paren in a search term does not
 * fail loudly — it reparses into a different filter. Stripping the
 * structural characters, quotes and backslashes keeps the term a term.
 */
export function ilikeTerm(raw: string): string | null {
  const cleaned = raw
    .replace(/[(),"\\]/g, ' ')
    .replace(/[*%]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Build an `ilike` OR-expression across several columns. */
export function ilikeAcross(columns: string[], term: string): string {
  return columns.map((col) => `${col}.ilike."%${term}%"`).join(',');
}
