export type BoardScope = 'focus' | 'all';

export const BOARD_SCOPES: ReadonlyArray<{ id: BoardScope; label: string }> = [
  { id: 'focus', label: 'Focus' },
  { id: 'all', label: 'All' },
];

export interface BoardFocus {
  buyers: ReadonlySet<string>;
  properties: ReadonlySet<string>;
}

export function isFocusedDeal(
  deal: { contact_id?: string | null; property_id?: string | null },
  focus: BoardFocus
): boolean {
  return Boolean(
    (deal.contact_id && focus.buyers.has(deal.contact_id)) ||
    (deal.property_id && focus.properties.has(deal.property_id))
  );
}

export function boardDeals<
  T extends { contact_id?: string | null; property_id?: string | null },
>(deals: readonly T[], scope: BoardScope, focus: BoardFocus | null): T[] {
  if (scope === 'all' || !focus) return [...deals];
  return deals.filter((deal) => isFocusedDeal(deal, focus));
}
