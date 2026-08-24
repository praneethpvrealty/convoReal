import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260824114725_secure_beta_invite_issuance.sql",
  "utf8",
);
const tenantRoute = readFileSync("src/app/api/beta-invites/route.ts", "utf8");
const seedRoute = readFileSync(
  "src/app/api/admin/beta-invites/seed/route.ts",
  "utf8",
);

describe("beta invite issuance privilege boundary", () => {
  it("removes the caller-controlled seed flag from the tenant RPC", () => {
    expect(migration).toContain(
      "DROP FUNCTION IF EXISTS public.issue_beta_invite(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN)",
    );
    expect(tenantRoute).not.toContain("p_as_seed");
  });

  it("keeps seed issuance service-role-only at both grant and runtime", () => {
    expect(seedRoute).toContain('admin.rpc("issue_beta_seed"');
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.issue_beta_seed[\s\S]*?FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.issue_beta_seed[\s\S]*?TO service_role;/,
    );
    expect(migration).toContain(
      "IF auth.role() IS DISTINCT FROM 'service_role' THEN",
    );
  });

  it("does not expose tenant issuance to anon", () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.issue_beta_invite[\s\S]*?FROM PUBLIC, anon;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.issue_beta_invite[\s\S]*?TO authenticated, service_role;/,
    );
  });
});
