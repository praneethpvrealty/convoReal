import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import {
  betaInviteShareMessage,
  betaInviteUrl,
  generateBetaInvite,
  generateInviteCode,
  hashInviteToken,
} from "./invites";

describe("generateBetaInvite", () => {
  it("returns a hash that matches the plaintext token", () => {
    const { token, hash } = generateBetaInvite();
    expect(hash).toBe(hashInviteToken(token));
  });

  it("hashes the way the database does", () => {
    // migration 188's hash_beta_token() is
    // encode(sha256(convert_to(token,'UTF8')),'hex'). If these two
    // ever diverge, every redemption silently stops matching, so
    // pin the exact algorithm rather than trusting the helper.
    const { token, hash } = generateBetaInvite();
    const expected = createHash("sha256")
      .update(Buffer.from(token, "utf8"))
      .digest("hex");
    expect(hash).toBe(expected);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("issues a distinct token each call", () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => generateBetaInvite().token),
    );
    expect(tokens.size).toBe(50);
  });
});

describe("generateInviteCode", () => {
  it("is speakable — no characters that sound or look alike", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateInviteCode();
      expect(code).toMatch(/^CONVO-[23456789BCDFGHJKMNPQRSTVWXYZ]{4}$/);
      // 0/O, 1/I/L and vowels are all excluded: the code gets read
      // down a phone line and typed back.
      expect(code.slice(6)).not.toMatch(/[01OILAEU]/);
    }
  });

  it("does not collapse to a handful of values", () => {
    const codes = new Set(Array.from({ length: 300 }, generateInviteCode));
    expect(codes.size).toBeGreaterThan(280);
  });
});

describe("betaInviteUrl", () => {
  it("builds an /i/ link", () => {
    expect(betaInviteUrl("tok", "https://convoreal.com")).toBe(
      "https://convoreal.com/i/tok",
    );
  });

  it("tolerates a trailing slash so callers can pass env vars raw", () => {
    expect(betaInviteUrl("tok", "https://convoreal.com/")).toBe(
      "https://convoreal.com/i/tok",
    );
    expect(betaInviteUrl("tok", "https://convoreal.com///")).toBe(
      "https://convoreal.com/i/tok",
    );
  });

  it("does not collide with the team-invite path", () => {
    expect(betaInviteUrl("tok", "https://convoreal.com")).not.toContain(
      "/join/",
    );
  });
});

describe("betaInviteShareMessage", () => {
  const url = "https://convoreal.com/i/abc";

  it("opens with the inviter's name and ends with the link", () => {
    const msg = betaInviteShareMessage({
      url,
      inviterName: "Praneeth",
      seatsRemaining: null,
      expiryDays: 14,
    });
    // Name first (a real broker text starts with who's talking), URL
    // last (WhatsApp's link preview renders at the bottom, next to
    // the tap).
    expect(msg.startsWith("Praneeth here — ")).toBe(true);
    expect(msg.trimEnd().split("\n").pop()).toBe(url);
    expect(msg).toContain("dies in 14 days");
  });

  it("reads naturally with no inviter name", () => {
    const msg = betaInviteShareMessage({
      url,
      inviterName: null,
      seatsRemaining: null,
      expiryDays: 14,
    });
    expect(msg.startsWith("I've got a ConvoReal beta seat")).toBe(true);
    expect(msg.trimEnd().split("\n").pop()).toBe(url);
  });

  it("carries the Portfolio hook and the week-one action", () => {
    const msg = betaInviteShareMessage({
      url,
      inviterName: "Praneeth",
      seatsRemaining: null,
      expiryDays: 14,
    });
    expect(msg).toContain("free Portfolio");
    expect(msg).toContain("import your buyer list");
  });

  it("quotes remaining seats when they are known", () => {
    const msg = betaInviteShareMessage({
      url,
      inviterName: "Praneeth",
      seatsRemaining: 12,
      expiryDays: 14,
    });
    expect(msg).toContain("Only 12 of 100 seats left");
  });

  it("falls back to the generic line at zero, never 'Only 0 seats left'", () => {
    const msg = betaInviteShareMessage({
      url,
      inviterName: "Praneeth",
      seatsRemaining: 0,
      expiryDays: 14,
    });
    expect(msg).not.toContain("Only 0");
    expect(msg).toContain("Only 100 property consultants get in this month");
  });
});
