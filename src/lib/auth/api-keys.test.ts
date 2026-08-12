import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const maybeSingle = vi.fn();
const update = vi.fn(() => ({
  eq: vi.fn().mockResolvedValue({ error: null }),
}));

// Default: entitled. The body doubles as an assertion on the call
// shape — a caller that forgets the accountId gets `false`, not a
// silent pass. Individual tests override with mockResolvedValue.
const hasApiAccess = vi.fn(async (...args: unknown[]) => typeof args[1] === "string");
vi.mock("@/lib/billing/gates", () => ({
  accountHasApiAccess: (db: unknown, accountId: string) => hasApiAccess(db, accountId),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ is: () => ({ maybeSingle }) }),
      }),
      update,
    }),
  }),
}));

import {
  API_KEY_PREFIX,
  extractApiKey,
  generateApiKey,
  hashApiKey,
  isApiKeyScope,
  resolveApiKey,
  withApiKeyAuth,
} from "./api-keys";
import { __resetRateLimitForTests } from "@/lib/rate-limit";

function liveKeyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "key-1",
    account_id: "acct-1",
    name: "Claude Desktop",
    scopes: ["read"],
    key_hash: "will-be-overwritten",
    expires_at: null,
    revoked_at: null,
    last_used_at: null,
    account: { id: "acct-1", name: "Acme Realty", status: "active" },
    ...overrides,
  };
}

function req(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://example.com/api/v1/properties", { headers });
}

const routeCtx = { params: Promise.resolve({}) };

beforeEach(() => {
  maybeSingle.mockReset();
  update.mockClear();
  hasApiAccess.mockReset();
  hasApiAccess.mockResolvedValue(true);
  __resetRateLimitForTests();
});

describe("generateApiKey", () => {
  it("mints a prefixed key whose hash matches the plaintext", () => {
    const key = generateApiKey();
    expect(key.secret.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(key.hash).toBe(hashApiKey(key.secret));
  });

  it("exposes a display prefix that is not enough to authenticate", () => {
    const key = generateApiKey();
    expect(key.secret.startsWith(key.prefix)).toBe(true);
    expect(key.prefix.length).toBeLessThan(key.secret.length);
    expect(hashApiKey(key.prefix)).not.toBe(key.hash);
  });

  it("never repeats a secret", () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateApiKey().secret));
    expect(secrets.size).toBe(50);
  });
});

describe("isApiKeyScope", () => {
  it("accepts the two real scopes and nothing else", () => {
    expect(isApiKeyScope("read")).toBe(true);
    expect(isApiKeyScope("write")).toBe(true);
    expect(isApiKeyScope("admin")).toBe(false);
    expect(isApiKeyScope(null)).toBe(false);
  });
});

describe("extractApiKey", () => {
  it("reads a Bearer key", () => {
    expect(extractApiKey(req({ authorization: `Bearer ${API_KEY_PREFIX}abc` }))).toBe(
      `${API_KEY_PREFIX}abc`,
    );
  });

  it("reads an X-API-Key header", () => {
    expect(extractApiKey(req({ "x-api-key": `${API_KEY_PREFIX}abc` }))).toBe(
      `${API_KEY_PREFIX}abc`,
    );
  });

  it("ignores a Supabase JWT in the Bearer slot", () => {
    expect(extractApiKey(req({ authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.x.y" }))).toBeNull();
  });

  it("returns null when neither header is present", () => {
    expect(extractApiKey(req())).toBeNull();
  });
});

describe("resolveApiKey", () => {
  it("resolves a live key to its account context", async () => {
    const key = generateApiKey();
    maybeSingle.mockResolvedValue({
      data: liveKeyRow({ key_hash: key.hash, scopes: ["read", "write"] }),
      error: null,
    });

    const ctx = await resolveApiKey(key.secret);
    expect(ctx.accountId).toBe("acct-1");
    expect(ctx.scopes).toEqual(["read", "write"]);
    expect(ctx.account.name).toBe("Acme Realty");
  });

  it("rejects a value without the key prefix before touching the database", async () => {
    await expect(resolveApiKey("eyJhbGciOiJIUzI1NiJ9.x.y")).rejects.toThrow("Invalid API key");
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("rejects an unknown key", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(resolveApiKey(generateApiKey().secret)).rejects.toThrow("Invalid API key");
  });

  it("rejects an expired key", async () => {
    const key = generateApiKey();
    maybeSingle.mockResolvedValue({
      data: liveKeyRow({
        key_hash: key.hash,
        expires_at: "2020-01-01T00:00:00Z",
      }),
      error: null,
    });
    await expect(resolveApiKey(key.secret)).rejects.toThrow("expired");
  });

  it("rejects a key whose workspace was archived", async () => {
    const key = generateApiKey();
    maybeSingle.mockResolvedValue({
      data: liveKeyRow({
        key_hash: key.hash,
        account: { id: "acct-1", name: "Acme Realty", status: "archived" },
      }),
      error: null,
    });
    await expect(resolveApiKey(key.secret)).rejects.toThrow("archived");
  });

  it("rejects a key stripped of every scope", async () => {
    const key = generateApiKey();
    maybeSingle.mockResolvedValue({
      data: liveKeyRow({ key_hash: key.hash, scopes: [] }),
      error: null,
    });
    await expect(resolveApiKey(key.secret)).rejects.toThrow("no scopes");
  });

  it("drops scopes it does not recognise rather than trusting the row", async () => {
    const key = generateApiKey();
    maybeSingle.mockResolvedValue({
      data: liveKeyRow({ key_hash: key.hash, scopes: ["read", "superuser"] }),
      error: null,
    });
    expect((await resolveApiKey(key.secret)).scopes).toEqual(["read"]);
  });

  it("refreshes last_used_at on a key that has been idle", async () => {
    const key = generateApiKey();
    maybeSingle.mockResolvedValue({
      data: liveKeyRow({ key_hash: key.hash }),
      error: null,
    });
    await resolveApiKey(key.secret);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ last_used_at: expect.any(String) }),
    );
  });

  it("skips the last_used_at write for a key used moments ago", async () => {
    const key = generateApiKey();
    maybeSingle.mockResolvedValue({
      data: liveKeyRow({
        key_hash: key.hash,
        last_used_at: new Date().toISOString(),
      }),
      error: null,
    });
    await resolveApiKey(key.secret);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("withApiKeyAuth", () => {
  it("401s without a key and never runs the handler", async () => {
    const handler = vi.fn();
    const res = await withApiKeyAuth("read", handler)(req(), routeCtx);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "missing_api_key" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("403s when the key lacks the required scope", async () => {
    const key = generateApiKey();
    maybeSingle.mockResolvedValue({
      data: liveKeyRow({ key_hash: key.hash, scopes: ["read"] }),
      error: null,
    });

    const handler = vi.fn();
    const res = await withApiKeyAuth("write", handler)(
      req({ authorization: `Bearer ${key.secret}` }),
      routeCtx,
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "insufficient_scope" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes an account-scoped context to the handler on success", async () => {
    const key = generateApiKey();
    maybeSingle.mockResolvedValue({
      data: liveKeyRow({ key_hash: key.hash, scopes: ["read", "write"] }),
      error: null,
    });

    const handler = vi.fn(
      async (ctx) => new Response(JSON.stringify({ accountId: ctx.accountId })) as never,
    );
    await withApiKeyAuth("write", handler)(
      req({ authorization: `Bearer ${key.secret}` }),
      routeCtx,
    );

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toMatchObject({
      accountId: "acct-1",
      keyId: "key-1",
    });
  });

  it("rate-limits a key that floods the surface", async () => {
    const key = generateApiKey();
    maybeSingle.mockResolvedValue({
      data: liveKeyRow({ key_hash: key.hash }),
      error: null,
    });

    const route = withApiKeyAuth("read", async () => new Response("ok") as never);
    const headers = { authorization: `Bearer ${key.secret}` };

    let limited = false;
    for (let i = 0; i < 130; i += 1) {
      const res = await route(req(headers), routeCtx);
      if (res.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });
});

describe("plan gating", () => {
  it("402s a key whose workspace is not on a plan with API access", async () => {
    const key = generateApiKey();
    maybeSingle.mockResolvedValue({ data: liveKeyRow({ key_hash: key.hash }), error: null });
    hasApiAccess.mockResolvedValue(false);

    const handler = vi.fn();
    const res = await withApiKeyAuth("read", handler)(
      req({ authorization: `Bearer ${key.secret}` }),
      routeCtx,
    );

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      code: "plan_upgrade_required",
      upgradeRequired: "agency",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("checks entitlement on every request, not just at key creation", async () => {
    const key = generateApiKey();
    maybeSingle.mockResolvedValue({ data: liveKeyRow({ key_hash: key.hash }), error: null });

    const route = withApiKeyAuth("read", async () => new Response("ok") as never);
    const headers = { authorization: `Bearer ${key.secret}` };

    // Entitled today...
    expect((await route(req(headers), routeCtx)).status).not.toBe(402);
    // ...downgraded tomorrow, and the same key stops working.
    hasApiAccess.mockResolvedValue(false);
    expect((await route(req(headers), routeCtx)).status).toBe(402);

    expect(hasApiAccess).toHaveBeenCalledTimes(2);
  });

  it("scopes the entitlement check to the key's own account", async () => {
    const key = generateApiKey();
    maybeSingle.mockResolvedValue({
      data: liveKeyRow({ key_hash: key.hash, account_id: "acct-77" }),
      error: null,
    });

    await withApiKeyAuth("read", async () => new Response("ok") as never)(
      req({ authorization: `Bearer ${key.secret}` }),
      routeCtx,
    );

    expect(hasApiAccess.mock.calls[0][1]).toBe("acct-77");
  });
});
