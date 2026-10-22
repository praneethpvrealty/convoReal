import { describe, expect, it } from 'vitest';
import {
  NUDGE_GLOBAL_COOLDOWN_MS,
  NUDGE_PER_NUDGE_COOLDOWN_MS,
  markNudgeSeen,
  nudgeGlobalCooldownActive,
  pickNudge,
} from './nudge-pick';

const now = 1_700_000_000_000;

describe('nudge picking [ONB-002]', () => {
  it('skips a nudge shown within the last week and takes the next one', () => {
    const nudges = [{ id: 'a' }, { id: 'b' }];
    const seen = { a: now - NUDGE_PER_NUDGE_COOLDOWN_MS + 1 };
    expect(pickNudge(nudges, seen, now)).toEqual({ id: 'b' });
    expect(
      pickNudge(nudges, { a: now - NUDGE_PER_NUDGE_COOLDOWN_MS - 1 }, now)
    ).toEqual({ id: 'a' });
  });

  it('returns null when every nudge is on cooldown', () => {
    expect(pickNudge([{ id: 'a' }], { a: now }, now)).toBeNull();
    expect(pickNudge([], {}, now)).toBeNull();
  });

  it('holds one bubble per day across all nudges', () => {
    expect(nudgeGlobalCooldownActive(now - 1000, now)).toBe(true);
    expect(nudgeGlobalCooldownActive(now - NUDGE_GLOBAL_COOLDOWN_MS, now)).toBe(
      false
    );
    expect(nudgeGlobalCooldownActive(0, now)).toBe(false);
  });

  it('records a seen nudge without mutating the input', () => {
    const seen = { a: 1 };
    const next = markNudgeSeen(seen, 'b', now);
    expect(next).toEqual({ a: 1, b: now });
    expect(seen).toEqual({ a: 1 });
  });
});
