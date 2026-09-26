export type LauncherSide = 'left' | 'right';

export interface LauncherPlacement {
  side: LauncherSide;
  bottom: number;
}

export const LAUNCHER_EDGE_PX = 16;
export const LAUNCHER_STORAGE_KEY = 'copilot-launcher-placement';
const MIN_BOTTOM_PX = 16;
const TOP_CLEARANCE_PX = 80;
const DRAG_THRESHOLD_PX = 6;

export function isLauncherDrag(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > DRAG_THRESHOLD_PX;
}

export function clampLauncherBottom(
  bottom: number,
  viewportHeight: number,
  launcherHeight: number
): number {
  const max = Math.max(
    MIN_BOTTOM_PX,
    viewportHeight - TOP_CLEARANCE_PX - launcherHeight
  );
  return Math.min(max, Math.max(MIN_BOTTOM_PX, Math.round(bottom)));
}

export function snapLauncher(
  rect: { left: number; width: number; bottom: number; height: number },
  viewport: { width: number; height: number }
): LauncherPlacement {
  return {
    side: rect.left + rect.width / 2 < viewport.width / 2 ? 'left' : 'right',
    bottom: clampLauncherBottom(
      viewport.height - rect.bottom,
      viewport.height,
      rect.height
    ),
  };
}

export function parseLauncherPlacement(
  raw: string | null
): LauncherPlacement | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LauncherPlacement>;
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
