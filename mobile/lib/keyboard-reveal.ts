export const KEYBOARD_REVEAL_MARGIN = 24;

/**
 * How far a scroll view must scroll down so a focused field clears the
 * keyboard. Window coordinates throughout: `fieldTop`/`fieldBottom` and
 * `viewportTop` from measureInWindow, `keyboardTop` from the keyboard
 * event's endCoordinates.screenY. Returns 0 when the field already shows
 * above the keyboard, and never pushes the field's top out of the viewport
 * when the field is taller than the space left above the keyboard.
 */
export function keyboardRevealDelta({
  fieldTop,
  fieldBottom,
  viewportTop,
  keyboardTop,
  margin = KEYBOARD_REVEAL_MARGIN,
}: {
  fieldTop: number;
  fieldBottom: number;
  viewportTop: number;
  keyboardTop: number;
  margin?: number;
}): number {
  const hidden = fieldBottom + margin - keyboardTop;
  if (hidden <= 0) return 0;
  const room = Math.max(0, fieldTop - viewportTop - margin);
  return Math.min(hidden, room);
}
