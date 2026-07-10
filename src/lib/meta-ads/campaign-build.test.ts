import { describe, it, expect } from 'vitest';
import {
  inrToPaise,
  validateDailyBudgetInr,
  clampRadiusKm,
  buildTargeting,
  BUDGET_BOUNDS,
  RADIUS_BOUNDS,
} from '@/lib/meta-ads/campaign-build';

describe('inrToPaise', () => {
  it('converts rupees to integer paise', () => {
    expect(inrToPaise(300)).toBe(30000);
    expect(inrToPaise(199.5)).toBe(19950);
  });
  it('rounds to the nearest paise', () => {
    expect(inrToPaise(10.005)).toBe(1001);
  });
});

describe('validateDailyBudgetInr', () => {
  it('accepts a budget within bounds', () => {
    expect(validateDailyBudgetInr(500).ok).toBe(true);
  });
  it('rejects below the minimum', () => {
    const r = validateDailyBudgetInr(BUDGET_BOUNDS.minInr - 1);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain(String(BUDGET_BOUNDS.minInr));
  });
  it('rejects above the maximum', () => {
    expect(validateDailyBudgetInr(BUDGET_BOUNDS.maxInr + 1).ok).toBe(false);
  });
  it('rejects non-numbers / NaN / Infinity', () => {
    expect(validateDailyBudgetInr('300').ok).toBe(false);
    expect(validateDailyBudgetInr(NaN).ok).toBe(false);
    expect(validateDailyBudgetInr(Infinity).ok).toBe(false);
    expect(validateDailyBudgetInr(undefined).ok).toBe(false);
  });
});

describe('clampRadiusKm', () => {
  it('clamps to bounds and rounds', () => {
    expect(clampRadiusKm(0)).toBe(RADIUS_BOUNDS.minKm);
    expect(clampRadiusKm(1000)).toBe(RADIUS_BOUNDS.maxKm);
    expect(clampRadiusKm(7.6)).toBe(8);
  });
  it('falls back to the minimum for invalid input', () => {
    expect(clampRadiusKm(undefined)).toBe(RADIUS_BOUNDS.minKm);
    expect(clampRadiusKm(NaN)).toBe(RADIUS_BOUNDS.minKm);
  });
});

describe('buildTargeting', () => {
  it('builds a precise radius target from coordinates', () => {
    const result = buildTargeting({ latitude: 12.91, longitude: 77.64, city: 'Bengaluru' }, 5);
    expect(result.precise).toBe(true);
    expect(result.cityFallback).toBeNull();
    const geo = (result.targeting as { geo_locations: { custom_locations: Array<{ latitude: number; radius: number; distance_unit: string }> } }).geo_locations;
    expect(geo.custom_locations[0]).toMatchObject({ latitude: 12.91, longitude: 77.64, radius: 5, distance_unit: 'kilometer' });
  });

  it('clamps the radius inside the precise target', () => {
    const result = buildTargeting({ latitude: 1, longitude: 2 }, 999);
    const geo = result.targeting as { geo_locations: { custom_locations: Array<{ radius: number }> } };
    expect(geo.geo_locations.custom_locations[0].radius).toBe(RADIUS_BOUNDS.maxKm);
  });

  it('returns a city fallback (no targeting) when coordinates are absent', () => {
    const result = buildTargeting({ city: 'Mysore' }, 5);
    expect(result.precise).toBe(false);
    expect(result.targeting).toBeNull();
    expect(result.cityFallback).toBe('Mysore');
  });

  it('falls back to locality when city is missing', () => {
    const result = buildTargeting({ location: 'Whitefield' }, 5);
    expect(result.cityFallback).toBe('Whitefield');
  });

  it('reports no fallback when there is no location at all', () => {
    const result = buildTargeting({}, 5);
    expect(result.precise).toBe(false);
    expect(result.cityFallback).toBeNull();
  });
});
