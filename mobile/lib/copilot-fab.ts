export const COPILOT_FAB_SIZE = 52;
const TAB_BAR_HEIGHT = 74;
const FAB_GAP = 16;

export function copilotFabBottom(insetBottom: number): number {
  return Math.max(insetBottom, 12) + TAB_BAR_HEIGHT + FAB_GAP;
}

export function copilotFabClearance(insetBottom: number): number {
  return copilotFabBottom(insetBottom) + COPILOT_FAB_SIZE + FAB_GAP;
}

export type CopilotFabSide = 'left' | 'right';

export interface CopilotFabPlacement {
  side: CopilotFabSide;
  bottom: number;
}

export interface CopilotFabFrame {
  screenWidth: number;
  screenHeight: number;
  insetTop: number;
  insetBottom: number;
}

export const COPILOT_FAB_EDGE = 18;
const HEADER_CLEARANCE = 56;
const DRAG_THRESHOLD = 6;

export function defaultCopilotFabPlacement(
  insetBottom: number
): CopilotFabPlacement {
  return { side: 'right', bottom: copilotFabBottom(insetBottom) };
}

export function copilotFabLeft(
  side: CopilotFabSide,
  screenWidth: number
): number {
  return side === 'left'
    ? COPILOT_FAB_EDGE
    : screenWidth - COPILOT_FAB_EDGE - COPILOT_FAB_SIZE;
}

export function clampCopilotFabBottom(
  bottom: number,
  frame: CopilotFabFrame
): number {
  const min = copilotFabBottom(frame.insetBottom);
  const max = Math.max(
    min,
    frame.screenHeight -
      frame.insetTop -
      HEADER_CLEARANCE -
      COPILOT_FAB_SIZE -
      FAB_GAP
  );
  return Math.min(max, Math.max(min, bottom));
}

export function snapCopilotFab(
  from: CopilotFabPlacement,
  dx: number,
  dy: number,
  frame: CopilotFabFrame
): CopilotFabPlacement {
  const centerX =
    copilotFabLeft(from.side, frame.screenWidth) + COPILOT_FAB_SIZE / 2 + dx;
  return {
    side: centerX < frame.screenWidth / 2 ? 'left' : 'right',
    bottom: clampCopilotFabBottom(from.bottom - dy, frame),
  };
}

export function isCopilotFabDrag(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > DRAG_THRESHOLD;
}

export function parseCopilotFabPlacement(
  raw: string | null
): CopilotFabPlacement | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<CopilotFabPlacement>;
    if (
      (value.side === 'left' || value.side === 'right') &&
      typeof value.bottom === 'number' &&
      Number.isFinite(value.bottom)
    ) {
      return { side: value.side, bottom: value.bottom };
    }
  } catch {
    return null;
  }
  return null;
}
