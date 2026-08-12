import { describe, expect, it } from 'vitest';
import {
  gateSummary,
  hasGateActivity,
  toGateStatsMap,
} from '@/lib/inventory/gate-stats';

const stats = (o: Partial<ReturnType<typeof base>> = {}) => ({
  ...base(),
  ...o,
});
function base() {
  return {
    requested: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    liveGrants: 0,
    lastRequestedAt: null as string | null,
  };
}

describe('toGateStatsMap', () => {
  it('keys by property and coerces nulls to zero', () => {
    const map = toGateStatsMap([
      {
        property_id: 'p1',
        requested: 3,
        pending: 1,
        approved: 2,
        rejected: null,
        live_grants: null,
        last_requested_at: '2026-08-11T10:00:00Z',
      },
    ]);
    expect(map.p1).toEqual({
      requested: 3,
      pending: 1,
      approved: 2,
      rejected: 0,
      liveGrants: 0,
      lastRequestedAt: '2026-08-11T10:00:00Z',
    });
  });

  it('survives an empty or null result', () => {
    expect(toGateStatsMap(null)).toEqual({});
    expect(toGateStatsMap([])).toEqual({});
  });
});

describe('hasGateActivity', () => {
  it('is false for a gated listing nobody has asked about', () => {
    expect(hasGateActivity(stats())).toBe(false);
    expect(hasGateActivity(undefined)).toBe(false);
  });

  it('is true once a request or a live key exists', () => {
    expect(hasGateActivity(stats({ requested: 1 }))).toBe(true);
    // A key can outlive its request row, so grants count on their own.
    expect(hasGateActivity(stats({ liveGrants: 1 }))).toBe(true);
  });
});

describe('gateSummary', () => {
  it('says nothing for an untouched listing — a row of zeroes is noise', () => {
    expect(gateSummary(stats())).toBeNull();
    expect(gateSummary(undefined)).toBeNull();
  });

  it('leads with demand, then what needs doing, then live access', () => {
    expect(
      gateSummary(
        stats({ requested: 3, pending: 1, approved: 2, liveGrants: 2 })
      )
    ).toBe('3 asked · 1 waiting · 2 open');
  });

  it('omits the parts that are zero', () => {
    expect(
      gateSummary(stats({ requested: 4, approved: 4, liveGrants: 0 }))
    ).toBe('4 asked');
    expect(gateSummary(stats({ requested: 1, pending: 1 }))).toBe(
      '1 asked · 1 waiting'
    );
  });

  it('shows a live key whose request row is gone', () => {
    expect(gateSummary(stats({ liveGrants: 2 }))).toBe('2 open');
  });
});
