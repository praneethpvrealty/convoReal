export const COPILOT_FAB_SIZE = 52;
const TAB_BAR_HEIGHT = 74;
const FAB_GAP = 16;

export function copilotFabBottom(insetBottom: number): number {
  return Math.max(insetBottom, 12) + TAB_BAR_HEIGHT + FAB_GAP;
}

export function copilotFabClearance(insetBottom: number): number {
  return copilotFabBottom(insetBottom) + COPILOT_FAB_SIZE + FAB_GAP;
}
