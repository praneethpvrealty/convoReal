export interface KeysetCursor {
  created_at: string;
  id: string;
}

export function nextKeysetCursor(
  rows: readonly KeysetCursor[],
  pageSize: number
): KeysetCursor | undefined {
  if (rows.length < pageSize) return undefined;
  const last = rows[rows.length - 1];
  return last ? { created_at: last.created_at, id: last.id } : undefined;
}

export function olderThanCursor(cursor: KeysetCursor): string {
  const at = `"${cursor.created_at.replace(/"/g, '')}"`;
  const id = `"${cursor.id.replace(/"/g, '')}"`;
  return `created_at.lt.${at},and(created_at.eq.${at},id.lt.${id})`;
}

export function nextOffset(
  pages: readonly (readonly unknown[])[],
  pageSize: number
): number | undefined {
  const last = pages[pages.length - 1];
  if (!last || last.length < pageSize) return undefined;
  return pages.reduce((sum, page) => sum + page.length, 0);
}

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
