import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import {
  KNOWN_DUPLICATE_PREFIXES,
  LEGACY_SEQUENCE_CEILING,
  compareMigrations,
  findDuplicatePrefixes,
  findLateSequentialMigrations,
  findNewDuplicatePrefixes,
  isTimestampPrefix,
  migrationPrefix,
  migrationVersion,
  migrationsInApplyOrder,
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

describe("isTimestampPrefix", () => {
  it("accepts a 14-digit UTC stamp", () => {
    expect(isTimestampPrefix("20260814130000")).toBe(true);
  });

  it("rejects a sequential number", () => {
    expect(isTimestampPrefix("278")).toBe(false);
    expect(isTimestampPrefix("063")).toBe(false);
  });

  // Rolling forward rather than rejecting is how a typo becomes a
  // migration that claims to have been written on a day that does not
  // exist.
  it("rejects a date the calendar does not have", () => {
    expect(isTimestampPrefix("20260231000000")).toBe(false);
    expect(isTimestampPrefix("20261301000000")).toBe(false);
    expect(isTimestampPrefix("20260814250000")).toBe(false);
    expect(isTimestampPrefix("20260814136000")).toBe(false);
  });

  it("rejects a stamp from before the scheme existed", () => {
    expect(isTimestampPrefix("20250814130000")).toBe(false);
  });

  it("rejects the wrong width", () => {
    expect(isTimestampPrefix("2026081413000")).toBe(false);
    expect(isTimestampPrefix("202608141300000")).toBe(false);
  });
});

describe("migrationVersion", () => {
  it("tells the two schemes apart", () => {
    expect(migrationVersion("278_clear_rental_listing_yield.sql")).toEqual({
      prefix: "278",
      scheme: "legacy",
    });
    expect(migrationVersion("20260814130000_add_thing.sql")).toEqual({
      prefix: "20260814130000",
      scheme: "timestamp",
    });
  });

  it("is null for a file that is not a migration", () => {
    expect(migrationVersion("RUN_IN_SUPABASE_SQL_EDITOR.sql")).toBeNull();
  });
});

describe("findLateSequentialMigrations", () => {
  // The whole point of the cutover: reaching for the next free number
  // is what put two PRs on 276 and then on 277.
  it("catches a sequential migration added after the ceiling", () => {
    expect(
      findLateSequentialMigrations([
        `${LEGACY_SEQUENCE_CEILING}_history.sql`,
        `${LEGACY_SEQUENCE_CEILING + 1}_reaching_for_the_old_scheme.sql`,
      ])
    ).toEqual([`${LEGACY_SEQUENCE_CEILING + 1}_reaching_for_the_old_scheme.sql`]);
  });

  it("leaves the sequential history alone", () => {
    expect(
      findLateSequentialMigrations(["001_a.sql", "204_b.sql", "278_c.sql"])
    ).toEqual([]);
  });

  it("never objects to a timestamp", () => {
    expect(
      findLateSequentialMigrations(["20260814130000_a.sql"])
    ).toEqual([]);
  });
});

describe("compareMigrations", () => {
  // A plain sort puts a timestamp between 199 and 200, because '0'
  // beats '7' at the second character. Apply order is not string order.
  it("puts every timestamp after every sequential migration", () => {
    expect(
      migrationsInApplyOrder([
        "20260814130000_new.sql",
        "200_old.sql",
        "199_older.sql",
        "278_newest_sequential.sql",
      ])
    ).toEqual([
      "199_older.sql",
      "200_old.sql",
      "278_newest_sequential.sql",
      "20260814130000_new.sql",
    ]);
  });

  it("orders the sequential era numerically, not as text", () => {
    expect(compareMigrations("9_a.sql", "10_b.sql")).toBeLessThan(0);
  });

  it("orders timestamps chronologically", () => {
    expect(
      compareMigrations("20260814130000_a.sql", "20260814130001_b.sql")
    ).toBeLessThan(0);
  });

  it("drops files that are not migrations", () => {
    expect(
      migrationsInApplyOrder(["README.md", "001_a.sql"])
    ).toEqual(["001_a.sql"]);
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

  it("keeps the frozen list honest — every entry is still a real duplicate", () => {
    const actual = findDuplicatePrefixes(filenames);
    const stale = [...KNOWN_DUPLICATE_PREFIXES].filter((p) => !actual.has(p));
    expect(stale).toEqual([]);
  });

  // The cutover, enforced. Reaching for the next free number is exactly
  // what collided twice on 2026-08-14, and neither PR could see it
  // coming: `npm run migration:new "…"` stamps the clock instead.
  it("adds no new migration under the retired sequential scheme", () => {
    expect(findLateSequentialMigrations(filenames).join("\n")).toBe("");
  });

  // The ceiling is a record of history, not a dial. If it ever exceeds
  // the highest sequential file actually present, someone raised it to
  // make room for one more.
  it("keeps the ceiling at the real end of the sequential era", () => {
    const highest = Math.max(
      ...filenames
        .map(migrationVersion)
        .filter((v) => v?.scheme === "legacy")
        .map((v) => Number(v!.prefix))
    );
    expect(LEGACY_SEQUENCE_CEILING).toBe(highest);
  });
});
