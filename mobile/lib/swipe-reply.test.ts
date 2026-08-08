import { describe, expect, it } from 'vitest';

import {
  REPLY_TRIGGER_DISTANCE,
  replyDragOffset,
  replyProgress,
  shouldTriggerReply,
} from './swipe-reply';

describe('replyDragOffset', () => {
  it('ignores leftward and idle pulls', () => {
    expect(replyDragOffset(-120)).toBe(0);
    expect(replyDragOffset(0)).toBe(0);
  });

  it('tracks the finger up to the trigger point', () => {
    expect(replyDragOffset(20)).toBe(20);
    expect(replyDragOffset(REPLY_TRIGGER_DISTANCE)).toBe(REPLY_TRIGGER_DISTANCE);
  });

  it('resists past the trigger point instead of following the finger', () => {
    const offset = replyDragOffset(REPLY_TRIGGER_DISTANCE + 100);
    expect(offset).toBeGreaterThan(REPLY_TRIGGER_DISTANCE);
    expect(offset).toBeLessThan(REPLY_TRIGGER_DISTANCE + 100);
  });

  it('caps a swipe across the whole screen', () => {
    expect(replyDragOffset(4000)).toBe(replyDragOffset(900));
  });

  it('never moves backwards as the pull grows', () => {
    let previous = 0;
    for (let x = 0; x <= 400; x += 7) {
      const offset = replyDragOffset(x);
      expect(offset).toBeGreaterThanOrEqual(previous);
      previous = offset;
    }
  });
});

describe('replyProgress', () => {
  it('runs 0 → 1 across the trigger distance', () => {
    expect(replyProgress(0)).toBe(0);
    expect(replyProgress(REPLY_TRIGGER_DISTANCE / 2)).toBeCloseTo(0.5);
    expect(replyProgress(REPLY_TRIGGER_DISTANCE)).toBe(1);
  });

  it('clamps rather than overshooting', () => {
    expect(replyProgress(-40)).toBe(0);
    expect(replyProgress(REPLY_TRIGGER_DISTANCE * 3)).toBe(1);
  });
});

describe('shouldTriggerReply', () => {
  it('fires only once the bubble reached the trigger point', () => {
    expect(shouldTriggerReply(REPLY_TRIGGER_DISTANCE - 1)).toBe(false);
    expect(shouldTriggerReply(REPLY_TRIGGER_DISTANCE)).toBe(true);
  });

  it('does not fire on a tap that never moved', () => {
    expect(shouldTriggerReply(0)).toBe(false);
  });
});
