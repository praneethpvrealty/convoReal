import { describe, expect, it } from "vitest";
import {
  evaluateChallenge,
  hashOtpCode,
  isUpgradeDirection,
  isValidPlan,
  MAX_OTP_ATTEMPTS,
  shouldRegrantCredits,
  type OtpChallengeRow,
} from "./admin-plan-override";

const NOW = Date.parse("2026-07-12T10:00:00.000Z");
const FUTURE = new Date(NOW + 60_000).toISOString();
const PAST = new Date(NOW - 60_000).toISOString();

function baseChallenge(over: Partial<OtpChallengeRow> = {}): OtpChallengeRow {
  return {
    id: "challenge-1",
    admin_user_id: "admin-1",
    account_id: "account-1",
    from_plan: "starter",
    to_plan: "solo_pro",
    code_hash: hashOtpCode("123456"),
    attempts: 0,
    expires_at: FUTURE,
    used_at: null,
    ...over,
  };
}

const goodInput = {
  code: "123456",
  nowMs: NOW,
  adminUserId: "admin-1",
  accountId: "account-1",
  plan: "solo_pro",
};

describe("evaluateChallenge", () => {
  it("accepts a correct code within its binding and window", () => {
    const result = evaluateChallenge(baseChallenge(), goodInput);
    expect(result.ok).toBe(true);
  });

  it("rejects a missing challenge (not_found), no attempt increment", () => {
    const result = evaluateChallenge(null, goodInput);
    expect(result).toEqual({ ok: false, reason: "not_found", incrementAttempts: false });
  });

  it("rejects an already-used challenge (used), no attempt increment", () => {
    const result = evaluateChallenge(baseChallenge({ used_at: PAST }), goodInput);
    expect(result).toEqual({ ok: false, reason: "used", incrementAttempts: false });
  });

  it("rejects an expired challenge (expired), no attempt increment", () => {
    const result = evaluateChallenge(baseChallenge({ expires_at: PAST }), goodInput);
    expect(result).toEqual({ ok: false, reason: "expired", incrementAttempts: false });
  });

  it("treats expiry as inclusive (expires_at === now is expired)", () => {
    const result = evaluateChallenge(
      baseChallenge({ expires_at: new Date(NOW).toISOString() }),
      goodInput,
    );
    expect(result).toMatchObject({ ok: false, reason: "expired" });
  });

  it("rejects once attempts reach the cap (too_many_attempts), no further increment", () => {
    const result = evaluateChallenge(
      baseChallenge({ attempts: MAX_OTP_ATTEMPTS }),
      goodInput,
    );
    expect(result).toEqual({ ok: false, reason: "too_many_attempts", incrementAttempts: false });
  });

  it("rejects a challenge issued to a different admin (admin_mismatch), increments attempts", () => {
    const result = evaluateChallenge(baseChallenge(), { ...goodInput, adminUserId: "admin-2" });
    expect(result).toEqual({ ok: false, reason: "admin_mismatch", incrementAttempts: true });
  });

  it("rejects a challenge issued for a different account (account_mismatch), increments attempts", () => {
    const result = evaluateChallenge(baseChallenge(), { ...goodInput, accountId: "account-2" });
    expect(result).toEqual({ ok: false, reason: "account_mismatch", incrementAttempts: true });
  });

  it("rejects a challenge issued for a different target plan (plan_mismatch), increments attempts", () => {
    const result = evaluateChallenge(baseChallenge(), { ...goodInput, plan: "agency" });
    expect(result).toEqual({ ok: false, reason: "plan_mismatch", incrementAttempts: true });
  });

  it("rejects a wrong code (wrong_code), increments attempts", () => {
    const result = evaluateChallenge(baseChallenge(), { ...goodInput, code: "000000" });
    expect(result).toEqual({ ok: false, reason: "wrong_code", incrementAttempts: true });
  });

  it("checks binding before the code, so a wrong code AND wrong account reports account_mismatch", () => {
    const result = evaluateChallenge(baseChallenge(), {
      ...goodInput,
      accountId: "account-2",
      code: "000000",
    });
    expect(result).toMatchObject({ reason: "account_mismatch" });
  });
});

describe("isValidPlan / isUpgradeDirection", () => {
  it("accepts known plan strings, rejects unknown ones", () => {
    expect(isValidPlan("starter")).toBe(true);
    expect(isValidPlan("agency")).toBe(true);
    expect(isValidPlan("enterprise")).toBe(false);
    expect(isValidPlan("")).toBe(false);
  });

  it.each([
    ["starter", "solo_pro", true],
    ["solo_pro", "team", true],
    ["starter", "agency", true],
    ["team", "solo_pro", false],
    ["agency", "starter", false],
    ["solo_pro", "solo_pro", false],
  ] as const)("isUpgradeDirection(%s, %s) => %s", (from, to, expected) => {
    expect(isUpgradeDirection(from, to)).toBe(expected);
  });

  it("never treats a change involving an invalid plan string as an upgrade", () => {
    expect(isUpgradeDirection("starter", "bogus")).toBe(false);
    expect(isUpgradeDirection("bogus", "agency")).toBe(false);
  });
});

describe("shouldRegrantCredits", () => {
  it("re-grants on upgrade to a paid plan", () => {
    expect(shouldRegrantCredits("starter", "solo_pro")).toBe(true);
    expect(shouldRegrantCredits("solo_pro", "agency")).toBe(true);
  });

  it("does NOT re-grant on downgrade — balance is preserved until next cycle", () => {
    expect(shouldRegrantCredits("agency", "team")).toBe(false);
    expect(shouldRegrantCredits("solo_pro", "starter")).toBe(false);
  });

  it("does not re-grant a same-plan no-op", () => {
    expect(shouldRegrantCredits("team", "team")).toBe(false);
  });
});
