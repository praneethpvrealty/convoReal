import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import {
  KNOWN_DUPLICATE_PREFIXES,
  LEGACY_SEQUENCE_CEILING,
  findPostLegacySequentialMigrations,
  findDuplicatePrefixes,
  findNewDuplicatePrefixes,
  migrationPrefix,
} from "./numbering";

describe("migrationPrefix", () => {
  it("reads the leading number", () => {
    expect(migrationPrefix("207_restore_realtime_publication.sql")).toBe("207");
  });

  it("keeps the prefix as written so 063 and 63 stay distinct", () => {
    expect(migrationPrefix("063_a.sql")).toBe("063");
  });

  it("ignores files that are not numbered migrations", () => {
    expect(migrationPrefix("RUN_IN_SUPABASE_SQL_EDITOR.sql")).toBeNull();
    expect(migrationPrefix("207_restore_realtime_publication.sql.bak")).toBeNull();
    expect(migrationPrefix("README.md")).toBeNull();
  });
});

describe("findDuplicatePrefixes", () => {
  it("finds nothing when every prefix is unique", () => {
    expect(findDuplicatePrefixes(["001_a.sql", "002_b.sql"]).size).toBe(0);
  });

  it("groups the files sharing a prefix", () => {
    const dupes = findDuplicatePrefixes(["206_a.sql", "206_b.sql", "207_c.sql"]);
    expect(dupes.get("206")).toEqual(["206_a.sql", "206_b.sql"]);
    expect(dupes.has("207")).toBe(false);
  });
});

describe("findNewDuplicatePrefixes", () => {
  it("passes over the frozen history", () => {
    expect(findNewDuplicatePrefixes(["063_a.sql", "063_b.sql"]).size).toBe(0);
  });

  it("catches a fresh collision", () => {
    const fresh = findNewDuplicatePrefixes(["208_a.sql", "208_b.sql"]);
    expect([...fresh.keys()]).toEqual(["208"]);
  });
});

describe("supabase/migrations", () => {
  const filenames = readdirSync("supabase/migrations");

  it("has no migration number used twice beyond the frozen history", () => {
    const fresh = findNewDuplicatePrefixes(filenames);
    const detail = [...fresh.entries()]
      .map(([prefix, names]) => `${prefix}: ${names.join(", ")}`)
      .join("\n");
    expect(detail).toBe("");
  });


  it("rejects sequential numbering after the frozen legacy ceiling", () => {
    expect(
      findPostLegacySequentialMigrations([
        `${LEGACY_SEQUENCE_CEILING}_legacy.sql`,
        `${LEGACY_SEQUENCE_CEILING + 1}_new.sql`,
        "20260819042000_timestamped.sql",
      ])
    ).toEqual([`${LEGACY_SEQUENCE_CEILING + 1}_new.sql`]);
  });

  it("requires every new repository migration to use a timestamp", () => {
    expect(findPostLegacySequentialMigrations(filenames)).toEqual([]);
  });

  it("keeps the frozen list honest — every entry is still a real duplicate", () => {
    const actual = findDuplicatePrefixes(filenames);
    const stale = [...KNOWN_DUPLICATE_PREFIXES].filter((p) => !actual.has(p));
    expect(stale).toEqual([]);
  });
});
