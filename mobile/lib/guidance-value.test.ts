import { describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  ApiError: class ApiError extends Error {},
  apiFetch: vi.fn(),
}));

import {
  draftFromSchedule,
  formatRupees,
  rateHeadline,
  rateLocation,
  scheduleFromDraft,
  scheduleRejection,
} from './guidance-value';

describe('scheduleRejection', () => {
  it('accepts PDFs and photos under 4 MB', () => {
    expect(scheduleRejection('application/pdf', 1000)).toBeNull();
    expect(scheduleRejection('image/jpeg', null)).toBeNull();
  });

  it('refuses other types and large files', () => {
    expect(scheduleRejection('image/heic', 10)).toMatch(/PDF/);
    expect(scheduleRejection('application/pdf', 5 * 1024 * 1024)).toMatch(
      /4 MB/
    );
  });
});

describe('draft round trip', () => {
  it('[GVL-003] keeps floors only while no built-up area is typed', () => {
    const base = {
      locality: 'Koramangala 6th Block',
      road: '18th Main',
      kind: 'house' as const,
      floors: [
        { label: 'Ground', area: { value: 1916, unit: 'sqft' as const } },
      ],
    };
    const draft = draftFromSchedule(base);
    expect(draft.locality).toBe('Koramangala 6th Block');
    expect(scheduleFromDraft(draft, base).floors).toEqual(base.floors);

    const withArea = { ...draft, land_value: '2400', built_value: '4319' };
    const schedule = scheduleFromDraft(withArea, base);
    expect(schedule.land_area).toEqual({ value: '2400', unit: 'sqft' });
    expect(schedule.floors).toBeUndefined();
  });
});

describe('presentation', () => {
  it('formats rupees and rate lines', () => {
    expect(formatRupees(1234567.4)).toBe('₹12,34,567');
    expect(
      rateHeadline({
        rate: 210000,
        unit: 'sqm',
        property_class: 'residential_site',
      })
    ).toBe('₹2,10,000 / sq.m · Residential site');
    expect(
      rateHeadline({
        rate: 1533000,
        unit: 'acre',
        property_class: 'agricultural',
        land_class: 'plantation',
      })
    ).toBe('₹15,33,000 / acre · Agricultural · Plantation');
    expect(
      rateLocation({
        road: '18th Main',
        locality: 'Koramangala 6th Block',
        village: null,
        hobli: null,
        taluk: null,
      })
    ).toBe('18th Main, Koramangala 6th Block');
  });
});
