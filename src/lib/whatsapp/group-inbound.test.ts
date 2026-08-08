import { describe, expect, it } from "vitest";

import { groupIdFromInbound, isGroupInbound } from "./group-inbound";

describe("groupIdFromInbound", () => {
  it("reads the group id off the message, where Meta puts it", () => {
    expect(groupIdFromInbound({ group_id: "123@g.us" })).toBe("123@g.us");
  });

  it("falls back to the value envelope", () => {
    // Meta documents the field's meaning but publishes no raw JSON for
    // a group inbound, so the envelope is checked as well.
    expect(groupIdFromInbound({}, { group_id: "456" })).toBe("456");
  });

  it("prefers the message over the envelope", () => {
    expect(groupIdFromInbound({ group_id: "msg" }, { group_id: "env" })).toBe(
      "msg",
    );
  });

  it("trims incidental whitespace", () => {
    expect(groupIdFromInbound({ group_id: "  g1  " })).toBe("g1");
  });

  it("is null for an ordinary one-to-one message", () => {
    // The important case: an unknown shape must degrade to the existing
    // 1:1 path, not to a wrong one.
    expect(groupIdFromInbound({})).toBeNull();
    expect(groupIdFromInbound(null)).toBeNull();
    expect(groupIdFromInbound(undefined, undefined)).toBeNull();
  });

  it("treats an empty or blank id as absent", () => {
    expect(groupIdFromInbound({ group_id: "" })).toBeNull();
    expect(groupIdFromInbound({ group_id: "   " })).toBeNull();
  });

  it("ignores a non-string id rather than coercing it", () => {
    expect(
      groupIdFromInbound({ group_id: 12345 as unknown as string }),
    ).toBeNull();
  });
});

describe("isGroupInbound", () => {
  it("splits group traffic from one-to-one traffic", () => {
    expect(isGroupInbound({ group_id: "g1" })).toBe(true);
    expect(isGroupInbound({ from: "919000000000" } as never)).toBe(false);
  });
});
