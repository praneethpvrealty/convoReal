import { describe, it, expect } from 'vitest';
import {
  callTimeValue,
  callTimeValueLabel,
  hourlyValueInr,
  MANUAL_CALLS_PER_HOUR,
} from './time-value';

// The web copy is src/lib/credits/time-value.ts. These expectations are
// the same ones its suite asserts, so a change to one surface that is
// not made on the other fails here.

describe('hourlyValueInr', () => {
  it('spreads a salary over a 25-day, 8-hour month', () => {
    expect(hourlyValueInr(150_000)).toBe(750);
  });

  it('refuses to invent a value from a nonsense salary', () => {
    expect(hourlyValueInr(0)).toBe(0);
    expect(hourlyValueInr(Number.NaN)).toBe(0);
  });
});

describe('callTimeValue', () => {
  it('prices an hour of dialling below an hour of salary', () => {
    const v = callTimeValue(MANUAL_CALLS_PER_HOUR, 250, 150_000);
    expect(v.manualHours).toBe(1);
    expect(v.manualRupees).toBe(750);
    expect(Math.round(v.rupees)).toBe(347);
    expect(Math.round(v.savedRupees)).toBe(404);
  });

  it('is nearly all saving in byo mode', () => {
    const v = callTimeValue(MANUAL_CALLS_PER_HOUR, 10, 150_000);
    expect(Math.round(v.rupees)).toBe(14);
  });

  it('treats an empty run as costing nothing', () => {
    expect(callTimeValue(0, 250).credits).toBe(0);
  });
});

describe('callTimeValueLabel', () => {
  it('names the credits, the rupees, the hours and the saving', () => {
    const label = callTimeValueLabel(MANUAL_CALLS_PER_HOUR, 250, 150_000);
    expect(label).toContain('3,500 cr');
    expect(label).toContain('₹347');
    expect(label).toContain('₹750 of their time');
    expect(label).toContain('Saves about ₹404');
  });

  it('has nothing to say about an empty list', () => {
    expect(callTimeValueLabel(0, 250)).toBe(null);
  });
});
