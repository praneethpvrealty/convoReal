export interface StageWheelMotion {
  rotateYDegrees: number;
  translateZPixels: number;
  scale: number;
  opacity: number;
}

const MAX_SLOTS_FROM_CENTER = 2.5;
const FLICK_REACH_SLOTS = 3;

function round(value: number): number {
  return Math.round(value * 1000) / 1000 + 0;
}

export function stageWheelMotion(slotsFromCenter: number): StageWheelMotion {
  const distance = Math.max(
    -MAX_SLOTS_FROM_CENTER,
    Math.min(MAX_SLOTS_FROM_CENTER, slotsFromCenter)
  );
  const depth = Math.abs(distance);
  return {
    rotateYDegrees: round(distance * 24),
    translateZPixels: round(depth * -70),
    scale: round(1 - depth * 0.05),
    opacity: round(1 - depth * 0.22),
  };
}

export function wrapStageIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

export function initialWheelStageIndex(dealCounts: readonly number[]): number {
  const firstWithDeals = dealCounts.findIndex((count) => count > 0);
  return firstWithDeals === -1 ? 0 : firstWithDeals;
}

export function wheelSlotOffset(
  index: number,
  position: number,
  count: number
): number {
  if (count <= 0) return 0;
  let offset = (index - position) % count;
  if (offset > count / 2) offset -= count;
  if (offset <= -count / 2) offset += count;
  return round(offset);
}

export function wheelTurnTarget(
  position: number,
  index: number,
  count: number
): number {
  return round(position + wheelSlotOffset(index, position, count));
}

export function settleWheelPosition(
  position: number,
  velocitySlotsPerMs = 0
): number {
  const reach = Math.max(
    -FLICK_REACH_SLOTS,
    Math.min(FLICK_REACH_SLOTS, velocitySlotsPerMs * 160)
  );
  return Math.round(position + reach) + 0;
}

export function wheelStageIndexAt(position: number, count: number): number {
  return wrapStageIndex(Math.round(position), count);
}
