/**
 * How the Deals board lays its stages out.
 *
 * `flat` is one horizontal row of every stage, terminal stages at the
 * right edge, so the whole funnel reads at a glance. `wheel` is the
 * rotating stage carousel the board shipped with, kept behind a toggle
 * for anyone who prefers it. The choice is a device preference, not an
 * account setting; both surfaces remember it locally.
 *
 * Dependency-free: the mobile bundle imports this through `@shared/`.
 */

export type BoardLayout = 'flat' | 'wheel';

export const BOARD_LAYOUTS: ReadonlyArray<{
  id: BoardLayout;
  label: string;
  hint: string;
}> = [
  {
    id: 'flat',
    label: 'Flat',
    hint: 'Every stage side by side in one row',
  },
  {
    id: 'wheel',
    label: 'Wheel',
    hint: 'One stage in focus, the rest turned away',
  },
];

export const DEFAULT_BOARD_LAYOUT: BoardLayout = 'flat';

export const BOARD_LAYOUT_STORAGE_KEY = 'convoreal:deals-board-layout';

export function parseBoardLayout(
  value: string | null | undefined
): BoardLayout {
  return BOARD_LAYOUTS.some((layout) => layout.id === value)
    ? (value as BoardLayout)
    : DEFAULT_BOARD_LAYOUT;
}
