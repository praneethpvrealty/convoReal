export type LastActiveSort = 'desc' | 'asc' | null;

interface HasLastActive {
  last_active_at?: string | null;
}

function rank(row: HasLastActive, order: 'desc' | 'asc'): number {
  if (row.last_active_at === undefined) return Number.POSITIVE_INFINITY;
  if (row.last_active_at === null) {
    return order === 'asc' ? Number.NEGATIVE_INFINITY : Number.MAX_VALUE;
  }
  const time = new Date(row.last_active_at).getTime();
  return order === 'asc' ? time : -time;
}

export function sortByLastActive<T extends HasLastActive>(
  rows: T[],
  order: LastActiveSort
): T[] {
  if (!order) return rows;
  return [...rows].sort((a, b) => rank(a, order) - rank(b, order) || 0);
}

export function nextLastActiveSort(current: LastActiveSort): LastActiveSort {
  if (current === null) return 'desc';
  if (current === 'desc') return 'asc';
  return null;
}
