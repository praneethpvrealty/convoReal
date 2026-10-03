/** A month-grid day cell shows at most this many chips before folding the
 *  rest behind a "+N more" button, so a busy day never scrolls inside its
 *  own cell and every row keeps a bounded height. */
export const MONTH_CELL_VISIBLE_ITEMS = 2;

export function foldCellItems<T>(
  items: readonly T[],
  max: number = MONTH_CELL_VISIBLE_ITEMS
): { shown: T[]; hiddenCount: number } {
  if (items.length <= max) return { shown: [...items], hiddenCount: 0 };
  return { shown: items.slice(0, max), hiddenCount: items.length - max };
}

export function moreLabel(hiddenCount: number): string {
  return `+${hiddenCount} more`;
}
