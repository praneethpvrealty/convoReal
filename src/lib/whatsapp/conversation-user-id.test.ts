/**
 * Structural guard for `conversations.user_id`.
 *
 * The column is NOT NULL — a legacy holdover from the pre-account
 * tenancy model (migration 017_account_sharing.sql). Every insert has
 * to supply it, and the ones with no acting user (a webhook, a cron
 * digest, a group thread) fall back to the account owner.
 *
 * This exists because the groups work shipped two inserts that omitted
 * it. Nothing caught it: TypeScript does not know the column is NOT
 * NULL, the unit suite mocks Supabase, and the failure only appears the
 * first time a real group is created. A grep-level check is crude, but
 * it is the only thing that would have failed at review time.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found);
      continue;
    }
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
    found.push(full);
  }
  return found;
}

/**
 * Every `.insert(` that follows a `conversations` table reference,
 * paired with the window of source that insert spans.
 */
function conversationInserts(source: string): string[] {
  const blocks: string[] = [];
  const table = /\.from\(\s*['"]conversations['"]\s*\)/g;

  for (const match of source.matchAll(table)) {
    const after = source.slice(match.index ?? 0, (match.index ?? 0) + 600);
    const insertAt = after.indexOf(".insert(");
    if (insertAt === -1) continue;
    // An `.insert(` far past the table reference belongs to a different
    // statement; a real one follows within a few lines.
    if (after.slice(0, insertAt).split("\n").length > 4) continue;
    blocks.push(after.slice(insertAt, insertAt + 400));
  }
  return blocks;
}

describe("conversations.user_id", () => {
  const files = sourceFiles("src");

  it("is supplied by every conversation insert in the codebase", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("conversations")) continue;
      for (const block of conversationInserts(source)) {
        if (!block.includes("user_id")) {
          offenders.push(file.replace(`${process.cwd()}/`, ""));
        }
      }
    }

    expect(
      offenders,
      `conversations.user_id is NOT NULL — these inserts would fail at runtime:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("actually finds the inserts it is checking", () => {
    // A matcher that silently matches nothing would pass the test above
    // forever. Pin that it sees the real ones.
    const found = files
      .map((f) => readFileSync(f, "utf8"))
      .flatMap((s) => conversationInserts(s));

    expect(found.length).toBeGreaterThanOrEqual(5);
  });
});
