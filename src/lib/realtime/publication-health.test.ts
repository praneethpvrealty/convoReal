import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({ rpc }),
}));

import { checkRealtimePublication, REALTIME_TABLES } from "./publication-health";

beforeEach(() => rpc.mockReset());

describe("checkRealtimePublication", () => {
  it("is healthy when every expected table is published", async () => {
    rpc.mockResolvedValue({ data: [...REALTIME_TABLES], error: null });
    expect(await checkRealtimePublication()).toEqual({
      ok: true,
      present: [...REALTIME_TABLES],
      missing: [],
    });
  });

  it("reports the tables the rehost dropped", async () => {
    rpc.mockResolvedValue({ data: ["notifications"], error: null });
    const health = await checkRealtimePublication();
    expect(health.ok).toBe(false);
    expect(health.missing).toEqual([
      "conversations",
      "credit_wallets",
      "flow_runs",
      "message_reactions",
      "messages",
    ]);
  });

  it("treats an empty publication as everything missing", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const health = await checkRealtimePublication();
    expect(health.ok).toBe(false);
    expect(health.missing).toEqual([...REALTIME_TABLES]);
  });

  it("treats a null result as everything missing", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await checkRealtimePublication()).missing).toEqual([...REALTIME_TABLES]);
  });

  it("ignores tables published beyond the expected set", async () => {
    rpc.mockResolvedValue({ data: [...REALTIME_TABLES, "properties"], error: null });
    expect((await checkRealtimePublication()).ok).toBe(true);
  });

  it("throws rather than reporting healthy when the RPC fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    await expect(checkRealtimePublication()).rejects.toThrow("function does not exist");
  });
});

describe("REALTIME_TABLES", () => {
  // A table added to the migration but not here would be restored on a
  // rehost yet never checked; added here but not to the migration and
  // the check reports a permanent false failure. Read the migration and
  // hold the two together.
  it("matches the table list in migration 207", () => {
    const sql = readFileSync(
      "supabase/migrations/207_restore_realtime_publication.sql",
      "utf8",
    );
    const array = sql.match(/ARRAY\[([\s\S]*?)\]/);
    expect(array).not.toBeNull();
    const inMigration = [...array![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(inMigration).toEqual([...REALTIME_TABLES].sort());
  });
});
