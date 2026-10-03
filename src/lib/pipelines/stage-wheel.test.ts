import { describe, expect, it } from 'vitest';

import {
  initialWheelStageIndex,
  settleWheelPosition,
  stageWheelMotion,
  wheelSlotOffset,
  wheelStageIndexAt,
  wheelTurnTarget,
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

describe('[TXW-027] stage wheel ring', () => {
  it('fills both sides of the focused stage by wrapping the far end round', () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => wheelSlotOffset(i, 0, 6))).toEqual([
      0, 1, 2, 3, -2, -1,
    ]);
    expect([0, 1, 2, 3, 4].map((i) => wheelSlotOffset(i, 4, 5))).toEqual([
      1, 2, -2, -1, 0,
    ]);
    expect([0, 1, 2].map((i) => wheelSlotOffset(i, 1, 3))).toEqual([-1, 0, 1]);
  });

  it('keeps the wheel turning smoothly between stages', () => {
    expect(wheelSlotOffset(0, 0.5, 6)).toBe(-0.5);
    expect(wheelSlotOffset(5, 0.5, 6)).toBe(-1.5);
    expect(wheelSlotOffset(3, 0.5, 6)).toBe(2.5);
    expect(wheelSlotOffset(0, 7, 6)).toBe(-1);
    expect(wheelSlotOffset(0, -1, 6)).toBe(1);
    expect(wheelSlotOffset(2, 0, 0)).toBe(0);
  });

  it('turns to a tapped stage by the shorter way round', () => {
    expect(wheelTurnTarget(0, 5, 6)).toBe(-1);
    expect(wheelTurnTarget(0, 2, 6)).toBe(2);
    expect(wheelTurnTarget(7, 1, 6)).toBe(7);
    expect(wheelTurnTarget(4.4, 1, 5)).toBe(6);
  });

  it('settles on the nearest stage after a grab, further after a flick', () => {
    expect(settleWheelPosition(0.4)).toBe(0);
    expect(settleWheelPosition(0.6)).toBe(1);
    expect(settleWheelPosition(-0.6)).toBe(-1);
    expect(settleWheelPosition(0, 0.01)).toBe(2);
    expect(settleWheelPosition(0, -0.01)).toBe(-2);
    expect(settleWheelPosition(0, 1)).toBe(3);
    expect(settleWheelPosition(0, -1)).toBe(-3);
  });

  it('names the focused stage for any position on the ring', () => {
    expect(wheelStageIndexAt(0, 6)).toBe(0);
    expect(wheelStageIndexAt(5.6, 6)).toBe(0);
    expect(wheelStageIndexAt(-1, 6)).toBe(5);
    expect(wheelStageIndexAt(-0.4, 6)).toBe(0);
    expect(wheelStageIndexAt(3, 0)).toBe(0);
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
});
