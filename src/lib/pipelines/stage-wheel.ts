export interface StageWheelMotion {
  rotateYDegrees: number;
  translateZPixels: number;
  scale: number;
  opacity: number;
}

const MAX_SLOTS_FROM_CENTER = 2.5;

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

export function nearestWheelSlot(
  slotCenters: readonly number[],
  viewportCenter: number
): number {
  let nearest = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  slotCenters.forEach((center, index) => {
    const distance = Math.abs(center - viewportCenter);
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  });
  return nearest;
}
