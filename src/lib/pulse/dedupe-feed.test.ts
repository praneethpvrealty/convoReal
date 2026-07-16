import { describe, it, expect } from "vitest";
import { dedupeConsecutiveEvents } from "./dedupe-feed";
import type { HydratedShowcaseEvent } from "./queries";

function evt(
  overrides: Partial<HydratedShowcaseEvent> & { id: string; created_at: string }
): HydratedShowcaseEvent {
  return {
    account_id: "acc-1",
    contact_id: null,
    contact: null,
    property_id: null,
    property: null,
    session_key: "sess-1",
    event_type: "open",
    metadata: {},
    ...overrides,
  };
}

describe("dedupeConsecutiveEvents", () => {
  it("collapses consecutive identical events (same session/type/property) within the window", () => {
    const feed = [
      evt({ id: "3", created_at: "2026-01-01T00:02:00Z" }),
      evt({ id: "2", created_at: "2026-01-01T00:01:00Z" }),
      evt({ id: "1", created_at: "2026-01-01T00:00:00Z" }),
    ];
    const result = dedupeConsecutiveEvents(feed);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("3");
    expect(result[0].repeatCount).toBe(3);
  });

  it("does not merge across different sessions", () => {
    const feed = [
      evt({ id: "2", created_at: "2026-01-01T00:01:00Z", session_key: "sess-2" }),
      evt({ id: "1", created_at: "2026-01-01T00:00:00Z", session_key: "sess-1" }),
    ];
    const result = dedupeConsecutiveEvents(feed);
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.repeatCount === 1)).toBe(true);
  });

  it("does not merge across different event types or properties", () => {
    const feed = [
      evt({ id: "3", created_at: "2026-01-01T00:02:00Z", event_type: "view_property", property_id: "p-2" }),
      evt({ id: "2", created_at: "2026-01-01T00:01:00Z", event_type: "view_property", property_id: "p-1" }),
      evt({ id: "1", created_at: "2026-01-01T00:00:00Z", event_type: "open" }),
    ];
    const result = dedupeConsecutiveEvents(feed);
    expect(result).toHaveLength(3);
    expect(result.every((e) => e.repeatCount === 1)).toBe(true);
  });

  it("does not merge repeats outside the 5-minute window", () => {
    const feed = [
      evt({ id: "2", created_at: "2026-01-01T00:10:00Z" }),
      evt({ id: "1", created_at: "2026-01-01T00:00:00Z" }),
    ];
    const result = dedupeConsecutiveEvents(feed);
    expect(result).toHaveLength(2);
  });

  it("does not merge non-consecutive matching events separated by a different one", () => {
    const feed = [
      evt({ id: "3", created_at: "2026-01-01T00:02:00Z" }),
      evt({ id: "2", created_at: "2026-01-01T00:01:00Z", event_type: "view_property", property_id: "p-1" }),
      evt({ id: "1", created_at: "2026-01-01T00:00:00Z" }),
    ];
    const result = dedupeConsecutiveEvents(feed);
    expect(result).toHaveLength(3);
    expect(result.every((e) => e.repeatCount === 1)).toBe(true);
  });

  it("returns an empty array for an empty feed", () => {
    expect(dedupeConsecutiveEvents([])).toEqual([]);
  });
});
