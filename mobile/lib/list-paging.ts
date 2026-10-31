/**
 * Paging helpers for the long lists — the inbox, the contacts tab and a
 * chat thread — so each keeps loading as the agent scrolls instead of
 * stopping at its first page.
 */

export interface KeysetCursor {
  created_at: string;
  id: string;
}

/** The cursor for the page after `rows`, or undefined when `rows` was
 *  short and the list has run out. */
export function nextKeysetCursor(
  rows: readonly KeysetCursor[],
  pageSize: number
): KeysetCursor | undefined {
  if (rows.length < pageSize) return undefined;
  const last = rows[rows.length - 1];
  return last ? { created_at: last.created_at, id: last.id } : undefined;
}

/** PostgREST `.or()` filter for rows strictly older than `cursor` under
 *  `created_at desc, id desc`. The id breaks ties so two messages written
 *  in the same instant are neither repeated nor skipped. */
export function olderThanCursor(cursor: KeysetCursor): string {
  const at = `"${cursor.created_at.replace(/"/g, '')}"`;
  const id = `"${cursor.id.replace(/"/g, '')}"`;
  return `created_at.lt.${at},and(created_at.eq.${at},id.lt.${id})`;
}

/** The offset of the page after `pages`, or undefined when the last one
 *  came back short. */
export function nextOffset(
  pages: readonly (readonly unknown[])[],
  pageSize: number
): number | undefined {
  const last = pages[pages.length - 1];
  if (!last || last.length < pageSize) return undefined;
  return pages.reduce((sum, page) => sum + page.length, 0);
}

/** Flatten pages, keeping the first copy of any row an offset page saw
 *  twice because the list shifted between fetches. */
export function uniqueById<T extends { id: string }>(
  pages: readonly (readonly T[])[]
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const page of pages) {
    for (const row of page) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
  }
  return out;
}
