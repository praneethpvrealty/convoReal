import { describe, expect, it } from 'vitest';
import { listingExceedsStatedBudget } from './stated-budget';

describe('[INB-051] listingExceedsStatedBudget', () => {
  it('flags a listing well above the budget the lead stated', () => {
    expect(
      listingExceedsStatedBudget(210_000_000, { pref_budget_max: 150_000_000 })
    ).toBe(true);
    expect(
      listingExceedsStatedBudget(210_000_000, { max_budget: 150_000_000 })
    ).toBe(true);
  });

  it('allows a listing inside or just over the budget', () => {
    expect(
      listingExceedsStatedBudget(160_000_000, { pref_budget_max: 150_000_000 })
    ).toBe(false);
  });

  it('ignores a budget seeded from the enquired listing itself', () => {
    expect(
      listingExceedsStatedBudget(210_000_000, {
        pref_budget_max: 150_000_000,
        pref_budget_anchor: 150_000_000,
      })
    ).toBe(false);
  });

  it('says nothing when the price or the budget is unknown', () => {
    expect(listingExceedsStatedBudget(null, { pref_budget_max: 1 })).toBe(
      false
    );
    expect(listingExceedsStatedBudget(210_000_000, {})).toBe(false);
    expect(listingExceedsStatedBudget(210_000_000, null)).toBe(false);
  });
});
