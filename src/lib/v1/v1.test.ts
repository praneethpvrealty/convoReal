import { describe, expect, it } from "vitest";

import { page, pageArray, parsePageParams, V1_DEFAULT_LIMIT, V1_MAX_LIMIT } from "./pagination";
import { boolParam, enumParam, ilikeAcross, ilikeTerm, numParam } from "./query";
import { toV1Contact, toV1Property } from "./projections";

const url = (qs: string) => new URL(`https://example.com/api/v1/x${qs}`);

describe("parsePageParams", () => {
  it("defaults when nothing is supplied", () => {
    expect(parsePageParams(url(""))).toEqual({
      limit: V1_DEFAULT_LIMIT,
      offset: 0,
    });
  });

  it("clamps an oversized limit rather than erroring", () => {
    expect(parsePageParams(url("?limit=5000")).limit).toBe(V1_MAX_LIMIT);
  });

  it("collapses junk to the default instead of failing the request", () => {
    expect(parsePageParams(url("?limit=abc&offset=-4"))).toEqual({
      limit: V1_DEFAULT_LIMIT,
      offset: 0,
    });
  });

  it("floors fractional values", () => {
    expect(parsePageParams(url("?limit=10.9&offset=5.7"))).toEqual({
      limit: 10,
      offset: 5,
    });
  });
});

describe("page", () => {
  it("reports more when the total exceeds what has been served", () => {
    const result = page([1, 2], { limit: 2, offset: 0 }, 5);
    expect(result).toMatchObject({
      count: 2,
      has_more: true,
      next_offset: 2,
      total: 5,
    });
  });

  it("closes the page out on the last slice", () => {
    const result = page([1], { limit: 2, offset: 4 }, 5);
    expect(result.has_more).toBe(false);
    expect(result.next_offset).toBeNull();
  });

  it("falls back to a full page meaning more when no count was available", () => {
    expect(page([1, 2], { limit: 2, offset: 0 }, null).has_more).toBe(true);
    expect(page([1], { limit: 2, offset: 0 }, null).has_more).toBe(false);
  });
});

describe("pageArray", () => {
  it("slices an in-memory ranking and keeps the true total", () => {
    const all = Array.from({ length: 10 }, (_, i) => i);
    const result = pageArray(all, { limit: 3, offset: 6 });
    expect(result.items).toEqual([6, 7, 8]);
    expect(result.total).toBe(10);
    expect(result.has_more).toBe(true);
  });

  it("returns an empty page past the end", () => {
    const result = pageArray([1, 2], { limit: 5, offset: 10 });
    expect(result.items).toEqual([]);
    expect(result.has_more).toBe(false);
  });
});

describe("ilikeTerm", () => {
  it("keeps an ordinary term intact", () => {
    expect(ilikeTerm("Kokapet")).toBe("Kokapet");
  });

  it("strips the characters that would reparse a PostgREST or() expression", () => {
    expect(ilikeTerm("HSR Layout, Bengaluru (South)")).toBe("HSR Layout Bengaluru South");
  });

  it("removes wildcards so a search cannot widen itself", () => {
    expect(ilikeTerm("%_villa*")).toBe("_villa");
  });

  it("doubles embedded quotes rather than letting them close the literal", () => {
    expect(ilikeTerm('the "Grand" villa')).toBe('the ""Grand"" villa');
  });

  it("returns null for a term that is only punctuation", () => {
    expect(ilikeTerm("(),")).toBeNull();
    expect(ilikeTerm("   ")).toBeNull();
  });
});

describe("ilikeAcross", () => {
  it("builds one branch per column", () => {
    expect(ilikeAcross(["title", "city"], "villa")).toBe(
      'title.ilike."%villa%",city.ilike."%villa%"',
    );
  });
});

describe("numParam", () => {
  it("reads a number", () => {
    expect(numParam(url("?min_price=5000000"), "min_price")).toBe(5_000_000);
  });

  it("rejects negatives and junk", () => {
    expect(numParam(url("?min_price=-1"), "min_price")).toBeNull();
    expect(numParam(url("?min_price=cheap"), "min_price")).toBeNull();
  });

  it("distinguishes absent from zero", () => {
    expect(numParam(url(""), "min_price")).toBeNull();
    expect(numParam(url("?min_price=0"), "min_price")).toBe(0);
  });
});

describe("enumParam", () => {
  it("matches case-insensitively but returns the canonical value", () => {
    expect(enumParam(url("?status=OPEN"), "status", ["open", "won"] as const)).toBe("open");
  });

  it("returns null for a value outside the set", () => {
    expect(enumParam(url("?status=pending"), "status", ["open", "won"] as const)).toBeNull();
  });
});

describe("boolParam", () => {
  it("is tri-state so 'unset' and 'false' stay distinguishable", () => {
    expect(boolParam(url("?published=true"), "published")).toBe(true);
    expect(boolParam(url("?published=false"), "published")).toBe(false);
    expect(boolParam(url(""), "published")).toBeNull();
  });

  it("accepts 1 and 0", () => {
    expect(boolParam(url("?published=1"), "published")).toBe(true);
    expect(boolParam(url("?published=0"), "published")).toBe(false);
  });
});

describe("toV1Property location", () => {
  const loc = (sublocality: string | null, location: string | null) =>
    toV1Property({ id: "p1", title: "x", sublocality, location }).location;

  // Every pair below is real (sublocality, location) data from
  // production inventory. The first shipped rendering repeated the
  // locality on all of them — "HSR Layout, HSR Layout, Bengaluru,
  // Karnataka" — because it only skipped an EXACT duplicate, and an
  // exact duplicate is the case that almost never occurs.
  it("does not repeat a sublocality the location already contains", () => {
    expect(loc("Koramangala", "Koramangala, Bangalore, Karnataka")).toBe(
      "Koramangala, Bangalore, Karnataka",
    );
    expect(loc("HSR Layout", "19th Main road, HSR Layout, Bengaluru, Karnataka")).toBe(
      "19th Main road, HSR Layout, Bengaluru, Karnataka",
    );
    expect(loc("SJR Blue waters", "Kudlu, SJR Blue waters, Bangalore, Karnataka")).toBe(
      "Kudlu, SJR Blue waters, Bangalore, Karnataka",
    );
  });

  // The stored location is often self-repeating — the intake path has
  // appended the locality more than once over time. Upstream data, but
  // not something to hand to a reader.
  it("collapses a location that repeats itself", () => {
    expect(
      loc("Agara, HSR Layout", "Agara, HSR Layout, Agara, HSR Layout, Bangalore, Karnataka"),
    ).toBe("Agara, HSR Layout, Bangalore, Karnataka");
    // Three repeats collapse to one. "100 ft JP Nagar" survives
    // alongside "JP Nagar" on purpose: dedupe compares whole segments,
    // and dropping a segment merely because another contains it would
    // throw away real components of other addresses.
    expect(
      loc(
        "JP Nagar, 5th phase",
        "100 ft JP Nagar, 5th phase, JP Nagar, 5th phase, JP Nagar, 5th phase, Bangalore, Karnataka",
      ),
    ).toBe("100 ft JP Nagar, 5th phase, JP Nagar, Bangalore, Karnataka");
  });

  it("matches the sublocality case-insensitively", () => {
    expect(loc("hsr layout", "HSR Layout, Bengaluru")).toBe("HSR Layout, Bengaluru");
  });

  it("still prepends a sublocality the location genuinely omits", () => {
    expect(loc("Whitefield", "Bangalore, Karnataka")).toBe("Whitefield, Bangalore, Karnataka");
    expect(loc("Kokapet", "Hyderabad")).toBe("Kokapet, Hyderabad");
  });

  it("falls back to whichever of the two exists", () => {
    expect(loc(null, "Hyderabad")).toBe("Hyderabad");
    expect(loc("Kokapet", null)).toBe("Kokapet");
    expect(loc(null, null)).toBeNull();
  });

  it("treats a location of only separators as absent", () => {
    expect(loc("Kokapet", " , , ")).toBe("Kokapet");
    expect(loc(null, ",,")).toBeNull();
  });

  it("trims whitespace around segments", () => {
    expect(loc(null, "  Koramangala ,   Bangalore  ")).toBe("Koramangala, Bangalore");
  });
});

describe("toV1Property", () => {
  it("coerces numeric strings from PostgREST numerics", () => {
    const p = toV1Property({
      id: "p1",
      title: "x",
      price: "12500000",
      bedrooms: "3",
    });
    expect(p.price).toBe(12_500_000);
    expect(p.bedrooms).toBe(3);
  });

  it("labels an untitled listing rather than emitting an empty string", () => {
    expect(toV1Property({ id: "p1" }).title).toBe("(untitled)");
  });
});

describe("toV1Contact", () => {
  it("composes the full name from both name columns", () => {
    expect(toV1Contact({ id: "c1", name: "Asha", second_name: "Rao" }).name).toBe("Asha Rao");
  });

  it("returns null rather than an empty name", () => {
    expect(toV1Contact({ id: "c1" }).name).toBeNull();
  });

  it("keeps an unconstrained budget distinguishable from an unknown one", () => {
    expect(toV1Contact({ id: "c1", no_budget: true }).budget).toEqual({
      min: null,
      max: null,
      unconstrained: true,
    });
    expect(toV1Contact({ id: "c1" }).budget.unconstrained).toBe(false);
  });

  it("treats a missing requirement_active as active, matching the column default", () => {
    expect(toV1Contact({ id: "c1" }).requirement_active).toBe(true);
    expect(toV1Contact({ id: "c1", requirement_active: false }).requirement_active).toBe(false);
  });

  it("never leaks the contact_notes join used only for matching heuristics", () => {
    const contact = toV1Contact({
      id: "c1",
      contact_notes: [{ note_text: "internal" }],
    });
    expect(contact).not.toHaveProperty("contact_notes");
  });
});
