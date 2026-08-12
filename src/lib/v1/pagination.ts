// ============================================================
// Pagination and response envelope for /api/v1.
//
// Every list endpoint returns the same shape so a generic client (the
// MCP server, an automation node) can page any resource without
// special-casing it. Consumers of this surface are agents assembling
// an answer from several calls — an unbounded response burns their
// context, and a response that does not say whether more exists makes
// them guess.
// ============================================================

export const V1_DEFAULT_LIMIT = 25;
export const V1_MAX_LIMIT = 100;

export interface PageParams {
  limit: number;
  offset: number;
}

/**
 * Read `limit`/`offset` from a query string, clamping both into range.
 * Garbage collapses to the default rather than erroring — a paging
 * parameter is never the interesting part of a request.
 */
export function parsePageParams(url: URL): PageParams {
  const rawLimit = Number(url.searchParams.get("limit"));
  const rawOffset = Number(url.searchParams.get("offset"));

  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), V1_MAX_LIMIT)
      : V1_DEFAULT_LIMIT;

  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;

  return { limit, offset };
}

export interface Page<T> {
  items: T[];
  total: number | null;
  count: number;
  offset: number;
  limit: number;
  has_more: boolean;
  next_offset: number | null;
}

/**
 * Wrap a page of rows. `total` is null when the caller could not get an
 * exact count cheaply; `has_more` is still accurate in that case
 * because it falls back to "we filled the page".
 */
export function page<T>(items: T[], { limit, offset }: PageParams, total: number | null): Page<T> {
  const hasMore = total === null ? items.length === limit : offset + items.length < total;

  return {
    items,
    total,
    count: items.length,
    offset,
    limit,
    has_more: hasMore,
    next_offset: hasMore ? offset + items.length : null,
  };
}

/** Slice an already-materialised array — for endpoints that must rank
 *  in memory (matching) before they can page. */
export function pageArray<T>(all: T[], { limit, offset }: PageParams): Page<T> {
  return page(all.slice(offset, offset + limit), { limit, offset }, all.length);
}
