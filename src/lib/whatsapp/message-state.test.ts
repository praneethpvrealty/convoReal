import { describe, expect, it } from "vitest";

import {
  HIDE_CONFIRM_MESSAGE,
  MAX_PINNED_PER_CONVERSATION,
  canPinMore,
  pinAction,
  pinnedMessages,
  visibleMessages,
} from "./message-state";

describe("canPinMore", () => {
  it("allows pins up to the cap and no further", () => {
    expect(canPinMore(0)).toBe(true);
    expect(canPinMore(MAX_PINNED_PER_CONVERSATION - 1)).toBe(true);
    expect(canPinMore(MAX_PINNED_PER_CONVERSATION)).toBe(false);
  });

  it("stays closed if a thread somehow got past the cap", () => {
    expect(canPinMore(MAX_PINNED_PER_CONVERSATION + 5)).toBe(false);
  });
});

describe("visibleMessages", () => {
  it("drops hidden rows", () => {
    const messages = [
      { id: "a" },
      { id: "b", deleted_at: "2026-08-08T10:00:00Z" },
      { id: "c", deleted_at: null },
    ];
    expect(visibleMessages(messages).map((m) => m.id)).toEqual(["a", "c"]);
  });
});

describe("pinnedMessages", () => {
  it("returns newest pin first", () => {
    const pinned = pinnedMessages([
      { id: "old", pinned_at: "2026-08-01T10:00:00Z" },
      { id: "new", pinned_at: "2026-08-08T10:00:00Z" },
    ]);
    expect(pinned.map((m) => m.id)).toEqual(["new", "old"]);
  });

  it("ignores unpinned messages", () => {
    expect(pinnedMessages([{ id: "a" }, { id: "b", pinned_at: null }])).toEqual(
      [],
    );
  });

  it("never shows a pinned message that was hidden", () => {
    const pinned = pinnedMessages([
      { id: "a", pinned_at: "2026-08-08T10:00:00Z", deleted_at: "2026-08-08T11:00:00Z" },
    ]);
    expect(pinned).toEqual([]);
  });

  it("caps the bar even when the data is over the limit", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `m${i}`,
      pinned_at: `2026-08-0${i + 1}T10:00:00Z`,
    }));
    expect(pinnedMessages(many)).toHaveLength(MAX_PINNED_PER_CONVERSATION);
  });
});

describe("pinAction", () => {
  it("toggles on the message's current state", () => {
    expect(pinAction({ id: "a" })).toBe("pin");
    expect(pinAction({ id: "a", pinned_at: "2026-08-08T10:00:00Z" })).toBe(
      "unpin",
    );
  });
});

describe("hide copy", () => {
  // The one thing this feature must never do is imply a recall. If the
  // wording drifts, an agent tells a customer their message was deleted
  // when it is still on their phone.
  it("says the customer's copy stays", () => {
    expect(HIDE_CONFIRM_MESSAGE).toMatch(/customer/i);
    expect(HIDE_CONFIRM_MESSAGE).toMatch(/stays|cannot/i);
  });
});
