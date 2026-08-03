import { describe, it, expect } from 'vitest';
import { sanitizeFloorTenancies, totalAdvance, totalMonthlyRent } from './floor-tenancies';

describe('sanitizeFloorTenancies', () => {
  it('normalizes a valid rent-roll payload', () => {
    const rows = sanitizeFloorTenancies([
      {
        floor: ' 2nd + 3rd Floor ',
        area_sqft: 20000,
        tenant_name: 'Ramada Hospitality',
        monthly_rent: 1350000,
        advance: 8100000,
        lease_start: '2024-04-01',
        lease_end: '2033-03-31',
        lock_in_months: 36,
        maintenance: '₹5/sqft, borne by tenant',
        notes: '3-Star Hotel · 27 rooms',
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].floor).toBe('2nd + 3rd Floor');
    expect(rows[0].monthly_rent).toBe(1350000);
    expect(rows[0].advance).toBe(8100000);
    expect(rows[0].lease_start).toBe('2024-04-01');
    expect(rows[0].lock_in_months).toBe(36);
  });

  it('drops rows with no data and non-array payloads', () => {
    expect(sanitizeFloorTenancies([{ floor: '', tenant_name: '  ' }, {}])).toEqual([]);
    expect(sanitizeFloorTenancies('nonsense')).toEqual([]);
    expect(sanitizeFloorTenancies(null)).toEqual([]);
    expect(sanitizeFloorTenancies(undefined)).toEqual([]);
  });

  it('rejects malformed values without dropping the row', () => {
    const rows = sanitizeFloorTenancies([
      {
        floor: 'Fourth Floor',
        monthly_rent: 'not-a-number',
        advance: -1,
        lease_start: '01/04/2024', // wrong format
        lock_in_months: -5,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].monthly_rent).toBeNull();
    expect(rows[0].advance).toBeNull();
    expect(rows[0].lease_start).toBeNull();
    expect(rows[0].lock_in_months).toBeNull();
  });

  it('caps the number of rows', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ floor: `Floor ${i}` }));
    expect(sanitizeFloorTenancies(many).length).toBeLessThanOrEqual(60);
  });
});

describe('totalMonthlyRent', () => {
  it('sums rents across floors', () => {
    expect(
      totalMonthlyRent([
        { floor: 'A', monthly_rent: 1350000 } as never,
        { floor: 'B', monthly_rent: 375000 } as never,
        { floor: 'C', monthly_rent: null } as never,
      ]),
    ).toBe(1725000);
  });

  it('returns null when no floor has a rent figure', () => {
    expect(totalMonthlyRent([{ floor: 'A', monthly_rent: null } as never])).toBeNull();
    expect(totalMonthlyRent([])).toBeNull();
    expect(totalMonthlyRent(null)).toBeNull();
  });
});

describe('totalAdvance', () => {
  it('sums deposits across floors', () => {
    expect(
      totalAdvance([
        { floor: 'A', advance: 8100000 } as never,
        { floor: 'B', advance: 2250000 } as never,
        { floor: 'C', advance: null } as never,
      ]),
    ).toBe(10350000);
  });

  it('returns null when no floor records a deposit', () => {
    // Null, not 0 — a rent roll that has not captured deposits must not
    // assert the building holds none.
    expect(totalAdvance([{ floor: 'A', advance: null, monthly_rent: 500000 } as never])).toBeNull();
    expect(totalAdvance([])).toBeNull();
    expect(totalAdvance(null)).toBeNull();
  });

  it('is independent of the rent total', () => {
    const rows = [
      { floor: 'A', monthly_rent: 500000, advance: null } as never,
      { floor: 'B', monthly_rent: null, advance: 3000000 } as never,
    ];
    expect(totalMonthlyRent(rows)).toBe(500000);
    expect(totalAdvance(rows)).toBe(3000000);
  });
});
