import { describe, it, expect } from 'vitest';
import {
  callTimeValue,
  callTimeValueLabel,
  hourlyValueInr,
  CREDIT_INR,
  MANUAL_CALLS_PER_HOUR,
} from './time-value';

describe('hourlyValueInr', () => {
  it('spreads a salary over a 25-day, 8-hour month', () => {
    expect(hourlyValueInr(150_000)).toBe(750);
  });

  it('refuses to invent a value from a nonsense salary', () => {
    expect(hourlyValueInr(0)).toBe(0);
    expect(hourlyValueInr(-1)).toBe(0);
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

  it('scales with the recipient count', () => {
    const v = callTimeValue(15, 250);
    expect(v.credits).toBe(3750);
    expect(v.rupees).toBeCloseTo(3750 * CREDIT_INR, 5);
  });

  it('is nearly all saving in byo mode, where we bill orchestration only', () => {
    const v = callTimeValue(MANUAL_CALLS_PER_HOUR, 10, 150_000);
    expect(Math.round(v.rupees)).toBe(14);
    expect(Math.round(v.savedRupees)).toBe(736);
  });

  it('reports a negative saving rather than hiding it', () => {
    const v = callTimeValue(MANUAL_CALLS_PER_HOUR, 250, 20_000);
    expect(v.savedRupees).toBeLessThan(0);
  });

  it('treats an empty run as costing nothing', () => {
    expect(callTimeValue(0, 250).credits).toBe(0);
    expect(callTimeValue(-5, 250).credits).toBe(0);
  });
});

describe('callTimeValueLabel', () => {
  it('names the credits, the rupees, the hours and the saving', () => {
    const label = callTimeValueLabel(MANUAL_CALLS_PER_HOUR, 250, 150_000);
    expect(label).toContain('3,500 cr');
    expect(label).toContain('₹347');
    expect(label).toContain('1.0 hours');
    expect(label).toContain('₹750 of their time');
    expect(label).toContain('Saves about ₹404');
  });

  it('falls back to minutes for a short run', () => {
    const label = callTimeValueLabel(7, 250, 150_000);
    expect(label).toContain('30 minutes');
  });

  it('omits the saving claim when there is none', () => {
    const label = callTimeValueLabel(MANUAL_CALLS_PER_HOUR, 250, 20_000);
    expect(label).not.toContain('Saves');
  });

  it('has nothing to say about an empty list', () => {
    expect(callTimeValueLabel(0, 250)).toBe(null);
  });
});
