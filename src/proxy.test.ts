import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Regression test: /api/whatsapp/flows/endpoint/[accountId] is Meta's
 * server-to-server Flows data-exchange callback (health-check pings,
 * INIT, data_exchange) — it never carries a browser session cookie and
 * authenticates itself via HMAC signature + RSA/AES encryption inside
 * the route handler. The blanket "/api/whatsapp/* needs a session
 * unless the path says /webhook" gate below was rejecting it with 401
 * before the route ever ran, which made Meta's publish health check
 * (and the flow itself, once published) permanently fail.
 */

let mockUser: { id: string } | null = null;

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: mockUser }, error: null }),
    },
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

const { proxy } = await import("./proxy");

function req(path: string) {
  return new NextRequest(`https://example.com${path}`, { method: "POST" });
}

describe("proxy — Meta Flows endpoint auth exemption", () => {
  beforeEach(() => {
    mockUser = null;
  });

  it("passes through unauthenticated to the Flows data-exchange endpoint (Meta calls this directly)", async () => {
    const res = await proxy(req("/api/whatsapp/flows/endpoint/acc-1"));
    expect(res.status).not.toBe(401);
  });

  it("still requires auth for /api/whatsapp/flows/setup (called from Settings UI)", async () => {
    const res = await proxy(req("/api/whatsapp/flows/setup"));
    expect(res.status).toBe(401);
  });

  it("still requires auth for /api/whatsapp/flows/send", async () => {
    const res = await proxy(req("/api/whatsapp/flows/send"));
    expect(res.status).toBe(401);
  });

  it("still requires auth for /api/whatsapp/flows/validate", async () => {
    const res = await proxy(req("/api/whatsapp/flows/validate"));
    expect(res.status).toBe(401);
  });

  it("still requires auth for other /api/whatsapp/* routes", async () => {
    const res = await proxy(req("/api/whatsapp/config"));
    expect(res.status).toBe(401);
  });

  it("still allows the inbound webhook through unauthenticated (pre-existing exemption)", async () => {
    const res = await proxy(req("/api/whatsapp/webhook"));
    expect(res.status).not.toBe(401);
  });

  it("allows an authenticated request through to /api/whatsapp/flows/setup", async () => {
    mockUser = { id: "user-1" };
    const res = await proxy(req("/api/whatsapp/flows/setup"));
    expect(res.status).not.toBe(401);
  });
});
