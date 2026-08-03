// ============================================================
// Bug report helpers — pure, no Supabase.
//
// The reference is what the reporter gets back. It exists so a
// tester can say "BUG-4F2A is still happening" instead of
// re-describing the report, which is the difference between a
// thread and a queue.
// ============================================================

import { randomInt } from "node:crypto";

/** Same speakable alphabet as invite codes — references get read
 *  aloud on calls and pasted into WhatsApp. */
const REF_ALPHABET = "23456789BCDFGHJKMNPQRSTVWXYZ";
const REF_LENGTH = 4;

export const BUG_SEVERITIES = [
  "blocker",
  "major",
  "minor",
  "idea",
] as const;
export type BugSeverity = (typeof BUG_SEVERITIES)[number];

export const BUG_STATUSES = [
  "new",
  "triaged",
  "in_progress",
  "fixed",
  "wont_fix",
  "duplicate",
] as const;
export type BugStatus = (typeof BUG_STATUSES)[number];

export function isBugSeverity(value: unknown): value is BugSeverity {
  return (
    typeof value === "string" &&
    (BUG_SEVERITIES as readonly string[]).includes(value)
  );
}

export function isBugStatus(value: unknown): value is BugStatus {
  return (
    typeof value === "string" &&
    (BUG_STATUSES as readonly string[]).includes(value)
  );
}

export function generateBugReference(): string {
  let body = "";
  for (let i = 0; i < REF_LENGTH; i++) {
    body += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  }
  return `BUG-${body}`;
}

/**
 * Derive a title from the body when the reporter didn't give one.
 *
 * The capture form asks for two things, and "what happened" is the
 * one people actually fill in — forcing a separate title field is
 * how you turn a fifteen-second report into an abandoned one.
 */
export function deriveTitle(body: string): string {
  const firstLine = body.trim().split("\n")[0]?.trim() ?? "";
  if (!firstLine) return "Bug report";
  if (firstLine.length <= 80) return firstLine;
  // Cut on a word boundary so the title doesn't end mid-word.
  const cut = firstLine.slice(0, 80);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export const SEVERITY_LABEL: Record<BugSeverity, string> = {
  blocker: "Blocks my work",
  major: "Badly wrong",
  minor: "Small problem",
  idea: "Idea / request",
};

export const STATUS_LABEL: Record<BugStatus, string> = {
  new: "New",
  triaged: "Triaged",
  in_progress: "In progress",
  fixed: "Fixed",
  wont_fix: "Won't fix",
  duplicate: "Duplicate",
};
