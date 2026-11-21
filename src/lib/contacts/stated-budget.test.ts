import { describe, expect, it } from 'vitest';
import { listingExceedsStatedBudget, statedBudgetMax } from './stated-budget';

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

  it('lets the figure an agent typed win over the parsed one', () => {
    const contact = { max_budget: 500_000_000, pref_budget_max: 200_000_000 };
    expect(listingExceedsStatedBudget({ price: 400_000_000 }, contact)).toBe(
      false
    );
    expect(statedBudgetMax(contact)).toBe(500_000_000);
  });

  it('treats a zero budget as unknown and falls back to the other column', () => {
    expect(
      statedBudgetMax({ pref_budget_max: 0, max_budget: 150_000_000 })
    ).toBe(150_000_000);
    expect(statedBudgetMax({ pref_budget_max: 0 })).toBeNull();
  });

  it('counts a maximum equal to the enquiry price as stated once a minimum is given', () => {
    expect(
      statedBudgetMax({
        pref_budget_min: 100_000_000,
        pref_budget_max: 150_000_000,
        pref_budget_anchor: 150_000_000,
      })
    ).toBe(150_000_000);
  });

  it('has no ceiling for a contact marked as having no fixed budget', () => {
    expect(
      statedBudgetMax({ no_budget: true, pref_budget_max: 150_000_000 })
    ).toBeNull();
  });

  it('takes the widest ceiling across the briefs the matcher ranks on', () => {
    const contact = {
      requirements: 'Commercial building in HSR',
      pref_budget_max: 150_000_000,
      requirement_profiles: [
        {
          id: 'p2',
          raw_text: 'Also open to a larger building',
          active: true,
          budget_max: 300_000_000,
        },
      ],
    } as unknown as Parameters<typeof statedBudgetMax>[0];
    expect(statedBudgetMax(contact)).toBe(300_000_000);
    expect(listingExceedsStatedBudget({ price: 210_000_000 }, contact)).toBe(
      false
    );
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
