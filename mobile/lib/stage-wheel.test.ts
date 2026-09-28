import { describe, expect, it } from 'vitest';

import {
  initialWheelStageIndex,
  stageWheelMotion,
  wheelIndexForOffset,
  wrapStageIndex,
} from '@/lib/stage-wheel';

describe('stage wheel', () => {
  it('matches the web wheel motion', () => {
    expect(stageWheelMotion(0)).toEqual({
      rotateYDegrees: 0,
      translateZPixels: 0,
      scale: 1,
      opacity: 1,
    });
    expect(stageWheelMotion(1)).toEqual({
      rotateYDegrees: 24,
      translateZPixels: -70,
      scale: 0.95,
      opacity: 0.78,
    });
    expect(stageWheelMotion(-9)).toEqual(stageWheelMotion(-2.5));
  });

  it('wraps past either end so the wheel turns full circle', () => {
    expect(wrapStageIndex(5, 5)).toBe(0);
    expect(wrapStageIndex(-1, 5)).toBe(4);
    expect(wrapStageIndex(1, 0)).toBe(0);
  });

  it('opens on the first stage holding deals', () => {
    expect(initialWheelStageIndex([0, 0, 0, 0, 5])).toBe(4);
    expect(initialWheelStageIndex([0, 0])).toBe(0);
  });

  it('settles on the stage nearest the scroll offset', () => {
    expect(wheelIndexForOffset(0, 160, 5)).toBe(0);
    expect(wheelIndexForOffset(250, 160, 5)).toBe(2);
    expect(wheelIndexForOffset(9000, 160, 5)).toBe(4);
    expect(wheelIndexForOffset(-40, 160, 5)).toBe(0);
    expect(wheelIndexForOffset(100, 0, 5)).toBe(0);
  });
});
