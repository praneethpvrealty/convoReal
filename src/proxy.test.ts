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
let mockError: (Error & { code?: string }) | null = null;
let getUserCalls = 0;

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => {
        getUserCalls++;
        return {
          data: { user: mockError ? null : mockUser },
          error: mockError,
        };
      },
    },
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

const { proxy } = await import("./proxy");

// Cookie name shape @supabase/ssr writes for a browser session.
const SESSION_COOKIE = "sb-test-auth-token";

function req(path: string, headers?: Record<string, string>) {
  return new NextRequest(`https://example.com${path}`, { method: "POST", headers });
}

function signedInReq(path: string, headers?: Record<string, string>) {
  return req(path, { ...headers, cookie: `${SESSION_COOKIE}=session-value` });
}

function staleRefreshTokenError() {
  const err = new Error(
    "Invalid Refresh Token: Refresh Token Not Found",
  ) as Error & { code?: string };
  err.code = "refresh_token_not_found";
  return err;
}

// A syntactically valid (three-segment) JWT shape — value is never
// verified by the middleware, only its structure gates the exemption.
const BEARER_JWT = "Bearer aaa.bbb.ccc";

describe("proxy — Meta Flows endpoint auth exemption", () => {
  beforeEach(() => {
    mockUser = null;
    mockError = null;
    getUserCalls = 0;
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
    const res = await proxy(signedInReq("/api/whatsapp/flows/setup"));
    expect(res.status).not.toBe(401);
  });
});

/**
 * Regression test: the mobile app authenticates with
 * `Authorization: Bearer <jwt>` and carries no cookies, so the
 * cookie-based getUser() in the middleware always sees no user for it.
 * The `/api/whatsapp/*` gate is an early-exit optimisation, not the
 * boundary — the route handlers re-validate the bearer token via
 * createClient() + getUser(). A bearer-carrying request must therefore
 * pass through to its handler instead of being 401'd at the gate, or
 * every mobile send/react/media/broadcast call fails "Unauthorized"
 * before the route runs (while cookie-based web sessions work).
 */
describe("proxy — mobile bearer-token transport", () => {
  beforeEach(() => {
    mockUser = null;
    mockError = null;
    getUserCalls = 0;
  });

  it("passes a cookieless bearer-JWT request through to /api/whatsapp/send", async () => {
    const res = await proxy(req("/api/whatsapp/send", { authorization: BEARER_JWT }));
    expect(res.status).not.toBe(401);
  });

  it("passes a cookieless bearer-JWT request through to other /api/whatsapp/* routes", async () => {
    const res = await proxy(req("/api/whatsapp/react", { authorization: BEARER_JWT }));
    expect(res.status).not.toBe(401);
  });

  it("still 401s a cookieless request whose Authorization is not a JWT-shaped bearer", async () => {
    const res = await proxy(req("/api/whatsapp/send", { authorization: "Bearer notajwt" }));
    expect(res.status).toBe(401);
  });

  it("still 401s a cookieless request with no Authorization header", async () => {
    const res = await proxy(req("/api/whatsapp/send"));
    expect(res.status).toBe(401);
  });
});

/**
 * Regression test: a refresh token GoTrue no longer knows about (session
 * revoked elsewhere, rotated past the reuse window, truncated cookie
 * chunk) used to short-circuit the middleware — every /api/* path got a
 * 401 and every page got redirected to /login, regardless of whether the
 * path needed auth at all. That broke public showcase pages and public
 * API routes for anyone carrying a stale cookie, and because the early
 * return discarded supabaseResponse it also threw away the cookie
 * deletions @supabase/ssr had staged: the browser kept replaying the
 * dead token and every subsequent request re-ran the same doomed
 * refresh, spamming "Invalid Refresh Token: Refresh Token Not Found".
 */
describe("proxy — stale refresh token", () => {
  beforeEach(() => {
    mockUser = null;
    mockError = staleRefreshTokenError();
    getUserCalls = 0;
  });

  it("serves a public page instead of bouncing the visitor to /login", async () => {
    const res = await proxy(signedInReq("/property/some-listing"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets a public API route through instead of 401ing it", async () => {
    const res = await proxy(signedInReq("/api/public/showcase"));
    expect(res.status).not.toBe(401);
  });

  it("clears the dead auth cookie so the browser stops replaying it", async () => {
    const res = await proxy(signedInReq("/property/some-listing"));
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBe("");
  });

  it("clears chunked auth cookies too", async () => {
    const request = req("/property/some-listing", {
      cookie: `${SESSION_COOKIE}.0=first-half; ${SESSION_COOKIE}.1=second-half`,
    });
    const res = await proxy(request);
    expect(res.cookies.get(`${SESSION_COOKIE}.0`)?.value).toBe("");
    expect(res.cookies.get(`${SESSION_COOKIE}.1`)?.value).toBe("");
  });

  it("redirects a protected page to /login and clears the cookie on the redirect", async () => {
    const res = await proxy(signedInReq("/dashboard"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBe("");
  });

  it("still 401s an auth-gated /api/whatsapp/* route, and clears the cookie", async () => {
    const res = await proxy(signedInReq("/api/whatsapp/config"));
    expect(res.status).toBe(401);
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBe("");
  });
});

/**
 * A request with no Supabase auth cookie has no cookie session to
 * resolve, so the GoTrue round-trip is pure latency (and, on a public
 * page or webhook, pure load). The answer is "signed out" either way.
 */
describe("proxy — skips the auth round-trip when no session cookie is present", () => {
  beforeEach(() => {
    mockUser = null;
    mockError = null;
    getUserCalls = 0;
  });

  it("does not call getUser for a cookieless request", async () => {
    await proxy(req("/api/whatsapp/webhook"));
    expect(getUserCalls).toBe(0);
  });

  it("does not call getUser for a cookieless request carrying only non-auth cookies", async () => {
    await proxy(req("/", { cookie: "theme=violet" }));
    expect(getUserCalls).toBe(0);
  });

  it("still calls getUser when a session cookie is present", async () => {
    mockUser = { id: "user-1" };
    await proxy(signedInReq("/dashboard"));
    expect(getUserCalls).toBe(1);
  });
});
