export type BoardScope = 'focus' | 'all';

export const BOARD_SCOPES: ReadonlyArray<{ id: BoardScope; label: string }> = [
  { id: 'focus', label: 'Focus' },
  { id: 'all', label: 'All' },
];

export const BOARD_FOCUS_QUERY_KEY = 'board-focus';

/**
 * The deals the Board shows. Focus keeps the deals whose ids
 * `board_focus_deal_ids` returned; until those ids are known (loading or
 * failed) it shows nothing rather than quietly falling back to All.
 */
export function boardDeals<T extends { id: string }>(
  deals: readonly T[],
  scope: BoardScope,
  focusIds: readonly string[] | null | undefined
): T[] {
  if (scope === 'all') return [...deals];
  if (!focusIds) return [];
  const focus = new Set(focusIds);
  return deals.filter((deal) => focus.has(deal.id));
}
