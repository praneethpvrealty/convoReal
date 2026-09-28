/**
 * Stage wheel motion for the native bundle.
 *
 * `@shared/` is a types-only alias in the mobile app, so this pure helper
 * mirrors `src/lib/pipelines/stage-wheel.ts`. Keep both copies in step.
 */

export interface StageWheelMotion {
  rotateYDegrees: number;
  translateZPixels: number;
  scale: number;
  opacity: number;
}

const MAX_SLOTS_FROM_CENTER = 2.5;

export function stageWheelMotion(slotsFromCenter: number): StageWheelMotion {
  'worklet';
  const distance = Math.max(
    -MAX_SLOTS_FROM_CENTER,
    Math.min(MAX_SLOTS_FROM_CENTER, slotsFromCenter)
  );
  const depth = Math.abs(distance);
  const round = (value: number) => Math.round(value * 1000) / 1000 + 0;
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

export function wheelIndexForOffset(
  offset: number,
  itemWidth: number,
  count: number
): number {
  if (count <= 0 || itemWidth <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(offset / itemWidth)));
}
