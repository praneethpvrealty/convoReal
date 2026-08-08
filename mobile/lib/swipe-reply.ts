// The maths behind swipe-to-reply, kept apart from the gesture wiring so
// the thresholds are one readable thing rather than magic numbers spread
// through an animated style.
//
// Every function here is called from a Reanimated gesture callback on the
// UI thread, hence the worklet directives — they are also plain functions
// under Node, which is how the tests reach them.

/** How far right a bubble must travel before releasing it quotes it. */
export const REPLY_TRIGGER_DISTANCE = 56;

/** Hard cap on the drag, so a long pull cannot shove the bubble off-screen. */
const MAX_DRAG = 88;

/** Share of the pull past the trigger point that still moves the bubble —
 *  the rubber-band that says "this is as far as it goes". */
const OVERSHOOT_RESISTANCE = 0.32;

/**
 * Where the bubble sits for a given raw pan translation. Leftward pulls
 * are ignored outright: replies only ever come from a rightward swipe, and
 * letting the bubble drift left would fight the list's own gestures.
 */
export function replyDragOffset(translationX: number): number {
  'worklet';
  if (translationX <= 0) return 0;
  if (translationX <= REPLY_TRIGGER_DISTANCE) return translationX;
  return Math.min(
    MAX_DRAG,
    REPLY_TRIGGER_DISTANCE + (translationX - REPLY_TRIGGER_DISTANCE) * OVERSHOOT_RESISTANCE
  );
}

/** 0 → 1 as the bubble approaches the trigger point; drives the arrow
 *  that fades in behind it. */
export function replyProgress(offset: number): number {
  'worklet';
  if (offset <= 0) return 0;
  return Math.min(1, offset / REPLY_TRIGGER_DISTANCE);
}

/** Whether letting go here should open a reply. Distance only, no
 *  velocity term: a flick that never travelled is not an intent. */
export function shouldTriggerReply(offset: number): boolean {
  'worklet';
  return offset >= REPLY_TRIGGER_DISTANCE;
}
