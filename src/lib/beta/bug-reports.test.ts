import { describe, expect, it } from "vitest";

import {
  BUG_SEVERITIES,
  BUG_STATUSES,
  deriveTitle,
  generateBugReference,
  isBugSeverity,
  isBugStatus,
  SEVERITY_LABEL,
  STATUS_LABEL,
} from "./bug-reports";

describe("generateBugReference", () => {
  it("is speakable and correctly shaped", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateBugReference()).toMatch(
        /^BUG-[23456789BCDFGHJKMNPQRSTVWXYZ]{4}$/,
      );
    }
  });

  it("spreads across the space", () => {
    const refs = new Set(Array.from({ length: 300 }, generateBugReference));
    expect(refs.size).toBeGreaterThan(280);
  });
});

describe("deriveTitle", () => {
  it("uses the first line", () => {
    expect(deriveTitle("Inbox is blank\nSince this morning")).toBe(
      "Inbox is blank",
    );
  });

  it("falls back rather than returning an empty title", () => {
    // title is NOT NULL in the schema, so an empty derive would be a
    // constraint violation surfacing as a failed report.
    expect(deriveTitle("   \n  ")).toBe("Bug report");
    expect(deriveTitle("")).toBe("Bug report");
  });

  it("truncates long lines on a word boundary", () => {
    const long = `${"alpha ".repeat(40)}end`;
    const title = deriveTitle(long);
    expect(title.length).toBeLessThanOrEqual(81);
    expect(title.endsWith("…")).toBe(true);
    // Cut between words, not mid-word.
    expect(title).not.toMatch(/alph…$/);
  });

  it("leaves an exactly-80-char line alone", () => {
    const exact = "x".repeat(80);
    expect(deriveTitle(exact)).toBe(exact);
  });

  it("still truncates when there is no space to cut on", () => {
    const runOn = "x".repeat(200);
    const title = deriveTitle(runOn);
    expect(title.length).toBeLessThanOrEqual(81);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("severity and status guards", () => {
  it("accepts every value the database enum allows", () => {
    // These lists are the TS mirror of the bug_severity / bug_status
    // enums in migration 190. A drift here reaches the DB as a failed
    // insert, so pin both directions.
    for (const s of BUG_SEVERITIES) expect(isBugSeverity(s)).toBe(true);
    for (const s of BUG_STATUSES) expect(isBugStatus(s)).toBe(true);
  });

  it("rejects anything else", () => {
    for (const bad of ["critical", "", "NEW", null, 3, undefined, {}]) {
      expect(isBugSeverity(bad)).toBe(false);
      expect(isBugStatus(bad)).toBe(false);
    }
  });

  it("labels every enum value, so the UI can never render undefined", () => {
    for (const s of BUG_SEVERITIES) expect(SEVERITY_LABEL[s]).toBeTruthy();
    for (const s of BUG_STATUSES) expect(STATUS_LABEL[s]).toBeTruthy();
  });
});
