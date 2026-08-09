import { describe, expect, it } from 'vitest';
import type { ProjectUnitStats } from '@/types';
import {
  formatRatePerSqft,
  projectAvailabilityLine,
  projectBhkRange,
  projectPriceHeadline,
  projectRateHeadline,
  unitPremiumPercent,
  unitRatePerSqft,
} from './project-pricing';

function stats(over: Partial<ProjectUnitStats> = {}): ProjectUnitStats {
  return {
    project_id: 'proj-1',
    units: 12,
    available: 9,
    sold_or_contract: 3,
    min_price: 18500000,
    max_price: 32000000,
    min_rate_per_sqft: 8200,
    max_rate_per_sqft: 11400,
    min_bedrooms: 2,
    max_bedrooms: 4,
    ...over,
  };
}

describe('projectPriceHeadline', () => {
  it('quotes the cheapest unit a buyer can actually buy', () => {
    expect(projectPriceHeadline(stats())).toBe('From ₹1.85 Cr');
  });

  it('drops the "from" when there is nothing to range over', () => {
    // A repeated range reads like a bug.
    expect(
      projectPriceHeadline(stats({ min_price: 18500000, max_price: 18500000 })),
    ).toBe('₹1.85 Cr');
  });

  it('says sold out rather than quoting a price nobody can act on', () => {
    // min_price is null once no AVAILABLE unit is priced — but the
    // distinction that matters to a buyer is that it is gone.
    expect(
      projectPriceHeadline(
        stats({ available: 0, sold_or_contract: 12, min_price: null, max_price: null }),
      ),
    ).toBe('Sold out');
  });

  it('says price on request rather than implying free', () => {
    expect(projectPriceHeadline(stats({ min_price: null, max_price: null }))).toBe(
      'Price on request',
    );
  });

  it('does not call an empty project sold out', () => {
    expect(projectPriceHeadline(stats({ units: 0, available: 0, min_price: null }))).toBe(
      'Price on request',
    );
  });
});

describe('projectRateHeadline', () => {
  it('is the line the agent asked for', () => {
    expect(projectRateHeadline(stats())).toBe('From ₹8,200/sqft');
  });

  it('drops the range when every unit asks the same rate', () => {
    expect(
      projectRateHeadline(stats({ min_rate_per_sqft: 8200, max_rate_per_sqft: 8200 })),
    ).toBe('₹8,200/sqft');
  });

  it('is empty when no available unit has both a price and an area', () => {
    expect(
      projectRateHeadline(stats({ min_rate_per_sqft: null, max_rate_per_sqft: null })),
    ).toBe('');
  });
});

describe('formatRatePerSqft', () => {
  it('reads in rupees, not lakhs — a rate is not a price', () => {
    expect(formatRatePerSqft(8200)).toBe('₹8,200/sqft');
    expect(formatRatePerSqft(11400.6)).toBe('₹11,401/sqft');
  });

  it('is empty for nothing usable', () => {
    for (const v of [0, -1, null, undefined, NaN, Infinity]) {
      expect(formatRatePerSqft(v), String(v)).toBe('');
    }
  });
});

describe('projectBhkRange', () => {
  it('ranges when the project mixes configurations', () => {
    expect(projectBhkRange(stats())).toBe('2–4 BHK');
  });

  it('states one when they are all the same', () => {
    expect(projectBhkRange(stats({ min_bedrooms: 3, max_bedrooms: 3 }))).toBe('3 BHK');
  });

  it('is empty for land or commercial, which have no BHK', () => {
    expect(projectBhkRange(stats({ min_bedrooms: null, max_bedrooms: null }))).toBe('');
  });
});

describe('projectAvailabilityLine', () => {
  it('counts the units and names the sold ones', () => {
    expect(projectAvailabilityLine(stats())).toBe('12 units · 3 sold');
  });

  it('says nothing about sold when none are', () => {
    expect(projectAvailabilityLine(stats({ sold_or_contract: 0 }))).toBe('12 units');
  });

  it('is singular for one', () => {
    expect(
      projectAvailabilityLine(stats({ units: 1, available: 1, sold_or_contract: 0 })),
    ).toBe('1 unit');
  });

  it('tells the agent an empty project is empty', () => {
    expect(projectAvailabilityLine(stats({ units: 0 }))).toBe('No units added yet');
  });
});

describe('unitPremiumPercent', () => {
  it('measures a premium unit against the project floor', () => {
    // 11,400 against a floor of 8,200 — the number that justifies the
    // asking price without anyone ticking a "premium" box.
    expect(unitPremiumPercent(11400, stats())).toBe(39);
  });

  it('is zero for the unit that sets the floor', () => {
    expect(unitPremiumPercent(8200, stats())).toBe(0);
  });

  it('is null rather than a wrong number when either side is missing', () => {
    expect(unitPremiumPercent(null, stats())).toBeNull();
    expect(unitPremiumPercent(8200, stats({ min_rate_per_sqft: null }))).toBeNull();
    expect(unitPremiumPercent(8200, stats({ min_rate_per_sqft: 0 }))).toBeNull();
  });
});

describe('unitRatePerSqft', () => {
  it('divides price by area', () => {
    // 1,779 sqft SBA — the real 3BHK+3T from the plan.
    expect(unitRatePerSqft(14582000, 1779)).toBeCloseTo(8196.74, 1);
  });

  it('refuses to divide by a missing area', () => {
    expect(unitRatePerSqft(14582000, 0)).toBeNull();
    expect(unitRatePerSqft(14582000, null)).toBeNull();
    expect(unitRatePerSqft(null, 1779)).toBeNull();
  });
});
