import { describe, expect, it } from 'vitest';

import {
  initialWheelStageIndex,
  nearestWheelSlot,
  stageWheelMotion,
  wrapStageIndex,
} from '@/lib/pipelines/stage-wheel';

describe('stage wheel motion', () => {
  it('shows the focused stage face-on', () => {
    expect(stageWheelMotion(0)).toEqual({
      rotateYDegrees: 0,
      translateZPixels: 0,
      scale: 1,
      opacity: 1,
    });
  });

  it('turns neighbours away around a horizontal cylinder', () => {
    expect(stageWheelMotion(1)).toEqual({
      rotateYDegrees: 24,
      translateZPixels: -70,
      scale: 0.95,
      opacity: 0.78,
    });
    expect(stageWheelMotion(-1).rotateYDegrees).toBe(-24);
    expect(stageWheelMotion(-1).translateZPixels).toBe(-70);
  });

  it('clamps stages far from the centre so they stay legible', () => {
    expect(stageWheelMotion(9)).toEqual(stageWheelMotion(2.5));
    expect(stageWheelMotion(9).opacity).toBeGreaterThan(0.4);
  });
});

describe('stage wheel navigation', () => {
  it('wraps past either end so the wheel turns full circle', () => {
    expect(wrapStageIndex(5, 5)).toBe(0);
    expect(wrapStageIndex(-1, 5)).toBe(4);
    expect(wrapStageIndex(2, 5)).toBe(2);
    expect(wrapStageIndex(3, 0)).toBe(0);
  });

  it('opens on the first stage holding deals', () => {
    expect(initialWheelStageIndex([0, 0, 0, 0, 5])).toBe(4);
    expect(initialWheelStageIndex([0, 2, 3])).toBe(1);
    expect(initialWheelStageIndex([0, 0])).toBe(0);
  });

  it('focuses the stage nearest the centre of the view', () => {
    expect(nearestWheelSlot([160, 492, 824, 1156], 800)).toBe(2);
    expect(nearestWheelSlot([], 800)).toBe(0);
  });
});
