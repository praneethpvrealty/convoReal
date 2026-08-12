import { describe, expect, it } from "vitest";

import {
  toBuyerRow,
  toBuyerStats,
  toOwnerRow,
  toOwnerStats,
  totalFromRows,
} from "./portfolio";

describe("toOwnerStats", () => {
  it("converts the strings PostgREST sends for BIGINT and NUMERIC", () => {
    const stats = toOwnerStats({
      linked_owners: "12",
      owners_with_listings: "9",
      properties_total: "31",
      properties_available: "18",
      properties_under_contract: "4",
      properties_sold: "9",
      properties_published: "22",
      asking_value_available: "412500000",
      asking_price_avg_available: "22916667",
      bids_pending: "3",
      bids_accepted: "1",
    });

    expect(stats.linked_owners).toBe(12);
    expect(stats.properties.available).toBe(18);
    expect(stats.asking_value_available).toBe(412_500_000);
    expect(stats.bids).toEqual({ pending: 3, accepted: 1 });
  });

  it("returns a zeroed shape when the account has no linked owners", () => {
    const stats = toOwnerStats(null);
    expect(stats.linked_owners).toBe(0);
    expect(stats.properties.total).toBe(0);
    expect(stats.bids.pending).toBe(0);
  });

  it("keeps a null average distinct from zero", () => {
    // No available stock means nothing to average — reporting ₹0 would
    // read as "our listings are free".
    const stats = toOwnerStats({ properties_available: "0", asking_price_avg_available: null });
    expect(stats.asking_price_avg_available).toBeNull();
    expect(stats.properties.available).toBe(0);
  });
});

describe("toBuyerStats", () => {
  it("converts budget aggregates", () => {
    const stats = toBuyerStats({
      linked_buyers: "20",
      buyers_with_budget: "16",
      buyers_unconstrained_budget: "2",
      buyers_with_requirement: "14",
      budget_min_avg: "6500000",
      budget_max_avg: "14200000",
      budget_max_median: "12500000",
      budget_max_lowest: "3500000",
      budget_max_highest: "45000000",
      shortlist_items: "58",
      buyers_with_shortlist: "11",
    });

    expect(stats.linked_buyers).toBe(20);
    expect(stats.budget.max_avg).toBe(14_200_000);
    expect(stats.budget.max_median).toBe(12_500_000);
    expect(stats.shortlist).toEqual({ items: 58, buyers_with_items: 11 });
  });

  it("counts unconstrained budgets separately rather than averaging them in", () => {
    const stats = toBuyerStats({
      linked_buyers: "5",
      buyers_with_budget: "3",
      buyers_unconstrained_budget: "2",
    });
    expect(stats.buyers_with_budget).toBe(3);
    expect(stats.buyers_unconstrained_budget).toBe(2);
    // The two need not sum to linked_buyers — a buyer may have stated
    // neither a budget nor "no constraint".
    expect(stats.linked_buyers).toBe(5);
  });

  it("returns nulls, not zeros, when no buyer has stated a budget", () => {
    const stats = toBuyerStats({ linked_buyers: "4", buyers_with_budget: "0" });
    expect(stats.budget.max_avg).toBeNull();
    expect(stats.budget.max_median).toBeNull();
  });
});

describe("toOwnerRow", () => {
  const base = {
    den_user_id: "d1",
    contact_id: "c1",
    contact_name: "Ramesh Gupta",
    contact_phone: "919876543210",
    display_name: "R. Gupta",
    linked_at: "2026-03-01T00:00:00.000Z",
    digest_frequency: "weekly",
    properties_total: "4",
    properties_available: "3",
    properties_sold: "1",
    asking_value_available: "68000000",
    bids_pending: "2",
  };

  it("prefers the agency's own name for the contact", () => {
    expect(toOwnerRow(base).name).toBe("Ramesh Gupta");
  });

  it("falls back to the portal display name when the contact is unnamed", () => {
    expect(toOwnerRow({ ...base, contact_name: null }).name).toBe("R. Gupta");
  });

  it("returns null when neither name exists", () => {
    expect(toOwnerRow({ ...base, contact_name: null, display_name: null }).name).toBeNull();
  });

  it("nests the per-status counts", () => {
    expect(toOwnerRow(base).properties).toEqual({ total: 4, available: 3, sold: 1 });
  });
});

describe("toBuyerRow", () => {
  const base = {
    buyer_user_id: "b1",
    contact_id: "c2",
    contact_name: "Asha Rao",
    contact_phone: "919000000000",
    display_name: null,
    linked_at: "2026-04-02T00:00:00.000Z",
    min_budget: "9000000",
    max_budget: "13000000",
    no_budget: false,
    areas_of_interest: ["Kokapet", "Narsingi"],
    requirements: "3BHK near ORR",
    requirement_active: true,
    shortlist_count: "6",
  };

  it("nests the budget and carries the unconstrained flag", () => {
    expect(toBuyerRow(base).budget).toEqual({
      min: 9_000_000,
      max: 13_000_000,
      unconstrained: false,
    });
  });

  it("keeps an unconstrained budget distinguishable from an unknown one", () => {
    const row = toBuyerRow({ ...base, min_budget: null, max_budget: null, no_budget: true });
    expect(row.budget).toEqual({ min: null, max: null, unconstrained: true });
  });

  it("treats a missing requirement_active as active, matching the column default", () => {
    expect(toBuyerRow({ ...base, requirement_active: undefined }).requirement_active).toBe(true);
    expect(toBuyerRow({ ...base, requirement_active: false }).requirement_active).toBe(false);
  });

  it("defaults areas to an empty array rather than null", () => {
    expect(toBuyerRow({ ...base, areas_of_interest: null }).areas_of_interest).toEqual([]);
  });
});

describe("totalFromRows", () => {
  it("reads the repeated window count off the first row", () => {
    expect(totalFromRows([{ total_count: "57" }, { total_count: "57" }])).toBe(57);
  });

  it("is zero for an empty page, which carries no count to read", () => {
    expect(totalFromRows([])).toBe(0);
  });
});
