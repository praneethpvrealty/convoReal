import { describe, expect, it } from 'vitest';
import { listingExceedsStatedBudget } from './stated-budget';

describe('[INB-051] listingExceedsStatedBudget', () => {
  it('flags a listing well above the budget the lead stated', () => {
    expect(
      listingExceedsStatedBudget(
        { price: 210_000_000 },
        { pref_budget_max: 150_000_000 }
      )
    ).toBe(true);
    expect(
      listingExceedsStatedBudget(
        { price: 210_000_000 },
        { max_budget: 150_000_000 }
      )
    ).toBe(true);
  });

  it('allows a listing inside or just over the budget', () => {
    expect(
      listingExceedsStatedBudget(
        { price: 160_000_000 },
        { pref_budget_max: 150_000_000 }
      )
    ).toBe(false);
  });

  it('ignores a budget seeded from the enquired listing itself', () => {
    expect(
      listingExceedsStatedBudget(
        { price: 210_000_000 },
        {
          pref_budget_max: 150_000_000,
          pref_budget_anchor: 150_000_000,
        }
      )
    ).toBe(false);
  });

  it('judges a rental by its monthly rent, never its sale-price field', () => {
    const rental = {
      listing_type: 'Rent',
      price: 210_000_000,
      rent_per_month: 150_000,
    };
    expect(
      listingExceedsStatedBudget(rental, { pref_budget_max: 200_000 })
    ).toBe(false);
    expect(
      listingExceedsStatedBudget(rental, { pref_budget_max: 100_000 })
    ).toBe(true);
  });

  it('says nothing when the price or the budget is unknown', () => {
    expect(
      listingExceedsStatedBudget({ price: null }, { pref_budget_max: 1 })
    ).toBe(false);
    expect(listingExceedsStatedBudget({ price: 210_000_000 }, {})).toBe(false);
    expect(listingExceedsStatedBudget({ price: 210_000_000 }, null)).toBe(
      false
    );
  });
});
