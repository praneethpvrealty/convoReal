// ============================================================
// Per-account API keys — the auth transport for /api/v1/*.
//
// The staff surface has two transports already (cookie session, mobile
// bearer JWT), and both are Supabase sessions: short-lived, tied to a
// refresh token, scoped by RLS. Neither suits an unattended client —
// the MCP server, an automation platform, a partner script — which
// needs a credential it can hold for months and that an admin can
// revoke without touching anyone's login.
//
// A key is NOT a Supabase session, so RLS does not scope it. Routes
// built on `withApiKeyAuth` query through the service-role client and
// MUST filter by `ctx.accountId` in code — the same arrangement as the
// Den and buyer portals (see src/lib/den/auth.ts and AGENTS.md §8.3).
// That explicit scoping is the security boundary. `ctx.db` is an
// unscoped service-role client; handing its rows to a response without
// an account filter leaks every tenant.
//
// One consequence is easy to miss: an EMBEDDED JOIN is not filtered
// either. Under RLS, `.select('*, contact:contacts(...)')` has the
// policy applied to the embedded table too; under service-role it
// resolves the foreign key and returns whatever it points at. The v1
// routes that join (agenda, radar, deals) are therefore only as safe
// as the invariant that a row's FK targets never belong to another
// account — true of everything the app writes, but do not add a join
// on a table where that is not guaranteed.
//
// Storage: only the SHA-256 digest of a key is persisted (migration
// 256). The plaintext is returned once at creation. A plain digest is
// right here because the secret is 256 bits of CSPRNG output — there
// is no dictionary to attack, so a slow KDF would add per-request cost
// and buy nothing.
// ============================================================

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  AccountArchivedError,
  ForbiddenError,
  UnauthorizedError,
  toErrorResponse,
} from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

/** Distinguishes a key from a Supabase JWT in the same header slot. */
export const API_KEY_PREFIX = "cvr_sk_";

/** Characters of the random segment kept in `key_prefix` for display. */
const DISPLAY_CHARS = 6;

/** `last_used_at` is a coarse "is this key still in use" signal, not an
 *  audit log. Writing it on every request would double the write load
 *  of a read-only surface, so it is refreshed at most this often. */
const LAST_USED_THROTTLE_MS = 60_000;

export type ApiKeyScope = "read" | "write";

export const API_KEY_SCOPES: readonly ApiKeyScope[] = ["read", "write"] as const;

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
  return typeof value === "string" && (API_KEY_SCOPES as readonly string[]).includes(value);
}

export interface ApiKeyContext {
  /** Service-role client. Bypasses RLS — every query built on it MUST
   *  be scoped by `accountId`. */
  db: SupabaseClient;
  accountId: string;
  keyId: string;
  keyName: string;
  scopes: ApiKeyScope[];
  account: { id: string; name: string };
  /** The admin who minted the key. Rows written through v1 are
   *  attributed to them — several operational tables still carry a
   *  NOT NULL `user_id` (contacts, todos), and a key is not a user.
   *  Null once that admin has been removed from the workspace, which
   *  `requireApiKeyAuthor()` turns into a 409 rather than a 500. */
  createdByUserId: string | null;
}

/**
 * The user a write should be attributed to, or a response explaining
 * why there isn't one. Read-only routes never need this.
 */
export function requireApiKeyAuthor(ctx: ApiKeyContext): string | NextResponse {
  if (ctx.createdByUserId) return ctx.createdByUserId;
  return NextResponse.json(
    {
      error:
        "The user who created this API key is no longer a member of this workspace, so records created through it cannot be attributed. Re-issue the key.",
      code: "orphaned_api_key",
    },
    { status: 409 },
  );
}

export interface GeneratedApiKey {
  /** Full plaintext key. Returned to the caller once and never stored. */
  secret: string;
  /** Stored alongside the hash so the UI can identify a key. */
  prefix: string;
  hash: string;
}

/**
 * Mint a key. 32 bytes of CSPRNG output in base64url, behind a fixed
 * prefix so a leaked key is greppable in logs and recognisable in a
 * support ticket.
 */
export function generateApiKey(): GeneratedApiKey {
  const random = randomBytes(32).toString("base64url");
  const secret = `${API_KEY_PREFIX}${random}`;
  return {
    secret,
    prefix: `${API_KEY_PREFIX}${random.slice(0, DISPLAY_CHARS)}`,
    hash: hashApiKey(secret),
  };
}

export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/**
 * Read the presented key from either header. `Authorization: Bearer`
 * is what most clients (and the MCP server) send; `X-API-Key` is
 * accepted because several automation platforms cannot set an
 * Authorization header on a generic HTTP node.
 *
 * Returns null for a Bearer value that is not an API key, so a mobile
 * Supabase JWT arriving at a v1 route fails as "missing key" rather
 * than being hashed and looked up.
 */
export function extractApiKey(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    const candidate = match?.[1]?.trim();
    if (candidate && candidate.startsWith(API_KEY_PREFIX)) return candidate;
  }

  const direct = req.headers.get("x-api-key")?.trim();
  if (direct && direct.startsWith(API_KEY_PREFIX)) return direct;

  return null;
}

interface ApiKeyRow {
  id: string;
  account_id: string;
  name: string;
  created_by_user_id: string | null;
  scopes: string[] | null;
  key_hash: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  account:
    | { id: string; name: string; status: string | null }
    | { id: string; name: string; status: string | null }[]
    | null;
}

/**
 * Resolve a plaintext key into an account context.
 *
 * Throws `UnauthorizedError` for an unknown, revoked or expired key,
 * and `AccountArchivedError` for a key whose workspace was archived —
 * mirroring the block `getCurrentAccount()` applies to sessions, so an
 * archived tenant cannot keep pulling data through an integration.
 */
export async function resolveApiKey(secret: string): Promise<ApiKeyContext> {
  if (!secret.startsWith(API_KEY_PREFIX)) {
    throw new UnauthorizedError("Invalid API key");
  }

  const db = supabaseAdmin();
  const hash = hashApiKey(secret);

  const { data, error } = await db
    .from("account_api_keys")
    .select(
      "id, account_id, name, created_by_user_id, scopes, key_hash, expires_at, revoked_at, last_used_at, account:accounts!inner(id, name, status)",
    )
    .eq("key_hash", hash)
    .is("revoked_at", null)
    .maybeSingle<ApiKeyRow>();

  if (error) {
    console.error("[resolveApiKey] lookup error:", error);
    throw new UnauthorizedError("Could not verify API key");
  }
  if (!data) {
    throw new UnauthorizedError("Invalid API key");
  }

  // The lookup above already matched on the unique hash; this is a
  // belt-and-braces equality check that does not short-circuit, so no
  // information about the stored digest leaks through response timing.
  const presented = Buffer.from(hash, "utf8");
  const stored = Buffer.from(data.key_hash, "utf8");
  if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) {
    throw new UnauthorizedError("Invalid API key");
  }

  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    throw new UnauthorizedError("API key has expired");
  }

  const account = Array.isArray(data.account) ? data.account[0] : data.account;
  if (!account) {
    throw new UnauthorizedError("API key is not linked to a workspace");
  }
  if (account.status === "archived") {
    throw new AccountArchivedError();
  }

  const scopes = (data.scopes ?? []).filter(isApiKeyScope);
  if (scopes.length === 0) {
    throw new ForbiddenError("API key has no scopes");
  }

  void touchLastUsed(db, data.id, data.last_used_at);

  return {
    db,
    accountId: data.account_id,
    keyId: data.id,
    keyName: data.name,
    scopes,
    account: { id: account.id, name: account.name },
    createdByUserId: data.created_by_user_id ?? null,
  };
}

async function touchLastUsed(
  db: SupabaseClient,
  keyId: string,
  lastUsedAt: string | null,
): Promise<void> {
  if (lastUsedAt && Date.now() - new Date(lastUsedAt).getTime() < LAST_USED_THROTTLE_MS) {
    return;
  }
  const { error } = await db
    .from("account_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyId);
  if (error) {
    // Never fail a request over usage bookkeeping.
    console.error("[touchLastUsed] update error:", error);
  }
}

type ApiKeyHandler = (
  ctx: ApiKeyContext,
  req: NextRequest,
  routeCtx: { params: Promise<Record<string, string>> },
) => Promise<NextResponse>;

/**
 * Wrapper every /api/v1 route uses, so none can forget the key check,
 * the scope check, or the per-key rate limit.
 *
 * `requiredScope` is 'read' for GETs and 'write' for the mutating
 * routes; a read-only key is rejected before the handler runs.
 */
export function withApiKeyAuth(requiredScope: ApiKeyScope, handler: ApiKeyHandler) {
  return async (
    req: NextRequest,
    routeCtx: { params: Promise<Record<string, string>> },
  ): Promise<NextResponse> => {
    try {
      const secret = extractApiKey(req);
      if (!secret) {
        return NextResponse.json(
          {
            error:
              "Missing API key. Send it as 'Authorization: Bearer cvr_sk_…' or 'X-API-Key: cvr_sk_…'.",
            code: "missing_api_key",
          },
          { status: 401 },
        );
      }

      // Bound guessing before the DB is touched. Keyed by the digest so
      // the plaintext never reaches the limiter's key space, and so an
      // attacker rotating candidate keys still shares one budget per
      // candidate rather than getting a fresh one each attempt.
      const limit = checkRateLimit(`v1:${hashApiKey(secret)}`, RATE_LIMITS.apiKeyV1);
      if (!limit.success) return rateLimitResponse(limit);

      const ctx = await resolveApiKey(secret);

      if (!ctx.scopes.includes(requiredScope)) {
        return NextResponse.json(
          {
            error: `This API key lacks the '${requiredScope}' scope. Create a key with write access in Settings → API keys.`,
            code: "insufficient_scope",
          },
          { status: 403 },
        );
      }

      return await handler(ctx, req, routeCtx);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}
