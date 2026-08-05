export interface AnchoredMenuLayout {
  left: number;
  top: number;
  maxHeight: number;
}

/**
 * Place a floating menu against the press point inside a measured
 * frame: flip above the anchor when there is not enough room below,
 * pick the roomier side when neither fits, and report the height the
 * menu may occupy so a long list scrolls instead of running off-screen.
 */
export function anchoredMenuLayout({
  anchorX,
  anchorY,
  menuWidth,
  contentHeight,
  frameWidth,
  frameHeight,
  gap = 14,
  margin = 12,
}: {
  anchorX: number;
  anchorY: number;
  menuWidth: number;
  contentHeight: number;
  frameWidth: number;
  frameHeight: number;
  gap?: number;
  margin?: number;
}): AnchoredMenuLayout {
  // A press point captured before a rotation or fold can land outside
  // the current frame; clamp it in so neither side is credited with
  // room the frame does not have.
  const x = Math.min(Math.max(anchorX, 0), frameWidth);
  const y = Math.min(Math.max(anchorY, 0), frameHeight);

  const left = Math.max(margin, Math.min(x - menuWidth / 2, frameWidth - menuWidth - margin));

  const roomBelow = frameHeight - y - gap - margin;
  const roomAbove = y - gap - margin;
  const below = contentHeight <= roomBelow || roomBelow >= roomAbove;

  const maxHeight = Math.max(0, below ? roomBelow : roomAbove);
  const height = Math.min(contentHeight, maxHeight);
  const top = below ? Math.max(margin, y + gap) : Math.max(margin, y - gap - height);

  return { left, top, maxHeight };
}
