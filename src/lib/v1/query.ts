// ============================================================
// Filter parsing for /api/v1 list endpoints.
//
// The callers here are agents composing a query from a sentence, so
// inputs are looser than a form would produce: a stray comma, a price
// written "1.2cr", an empty string where a filter was meant. Parsing
// collapses what it cannot use rather than erroring — a dropped filter
// returns too many rows, which the agent can see and narrow, whereas a
// 400 just stalls it.
// ============================================================

/**
 * Escape a user string for use inside a PostgREST `.or()` expression.
 *
 * `.or()` takes a comma-separated filter list with parenthesised
 * groups, so an unescaped comma or paren in a search term does not
 * fail loudly — it reparses into a different filter. Doubling quotes
 * and stripping the structural characters keeps the term a term.
 */
export function ilikeTerm(raw: string): string | null {
  const cleaned = raw
    .replace(/[(),]/g, " ")
    .replace(/[*%]/g, "")
    .replace(/"/g, '""')
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Build an `ilike` OR-expression across several columns. */
export function ilikeAcross(columns: string[], term: string): string {
  return columns.map((col) => `${col}.ilike."%${term}%"`).join(",");
}

/** A finite, non-negative number from a query param, or null. */
export function numParam(url: URL, name: string): number | null {
  const raw = url.searchParams.get(name);
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** A query param constrained to a known set, case-insensitively. */
export function enumParam<T extends string>(
  url: URL,
  name: string,
  allowed: readonly T[],
): T | null {
  const raw = url.searchParams.get(name)?.trim().toLowerCase();
  if (!raw) return null;
  return allowed.find((a) => a.toLowerCase() === raw) ?? null;
}

/** A tri-state boolean param: true, false, or "caller didn't say". */
export function boolParam(url: URL, name: string): boolean | null {
  const raw = url.searchParams.get(name)?.trim().toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return null;
}
