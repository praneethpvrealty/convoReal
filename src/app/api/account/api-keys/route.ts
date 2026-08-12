// ============================================================
// /api/account/api-keys
//
//   GET  — list this account's keys (live and revoked).
//   POST — mint a new key.
//
// Both admin+, mirroring /api/account/invitations: issuing a
// long-lived credential is a privileged act, and the RLS policies on
// account_api_keys (migration 256) are admin-only to match.
//
// IMPORTANT: the plaintext key is returned exactly ONCE, in the POST
// response. Only its SHA-256 hash is stored, so neither GET nor any
// future route can resurface it. An admin who loses the key revokes
// and re-issues.
//
// Keys authenticate /api/v1/* only — never the dashboard's own routes,
// which stay on Supabase sessions.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  API_KEY_SCOPES,
  type ApiKeyScope,
  generateApiKey,
  isApiKeyScope,
} from "@/lib/auth/api-keys";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const MAX_NAME_LEN = 80;
const MAX_LIVE_KEYS = 20;
const MAX_EXPIRY_DAYS = 3650;

/** Columns safe to return. `key_hash` is deliberately absent — it is
 *  never useful to a client and there is no reason to put it on the
 *  wire. */
const KEY_COLUMNS =
  "id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_at, created_by_user_id";

export async function GET() {
  try {
    const ctx = await requireRole("admin");

    const { data, error } = await ctx.supabase
      .from("account_api_keys")
      .select(KEY_COLUMNS)
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[GET /api/account/api-keys] fetch error:", error);
      return NextResponse.json({ error: "Failed to load API keys" }, { status: 500 });
    }

    return NextResponse.json({ keys: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(`admin:apiKeyCreate:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      scopes?: unknown;
      expiresInDays?: unknown;
    } | null;

    const rawName = typeof body?.name === "string" ? body.name.trim() : "";
    if (!rawName) {
      return NextResponse.json(
        {
          error: "'name' is required — label the key with where it will be used",
        },
        { status: 400 },
      );
    }
    if (rawName.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `Name must be ${MAX_NAME_LEN} characters or fewer` },
        { status: 400 },
      );
    }

    // Default to read-only. A key that can write has to say so.
    let scopes: ApiKeyScope[] = ["read"];
    if (body?.scopes !== undefined) {
      if (!Array.isArray(body.scopes) || body.scopes.length === 0) {
        return NextResponse.json(
          {
            error: `'scopes' must be a non-empty array of ${API_KEY_SCOPES.join(", ")}`,
          },
          { status: 400 },
        );
      }
      const invalid = body.scopes.filter((s) => !isApiKeyScope(s));
      if (invalid.length > 0) {
        return NextResponse.json(
          {
            error: `Unknown scope(s): ${invalid.join(", ")}. Valid scopes: ${API_KEY_SCOPES.join(", ")}`,
          },
          { status: 400 },
        );
      }
      // A write key implies read; storing both keeps the scope check
      // in withApiKeyAuth a plain membership test.
      const requested = new Set(body.scopes as ApiKeyScope[]);
      requested.add("read");
      scopes = API_KEY_SCOPES.filter((s) => requested.has(s));
    }

    let expiresAt: string | null = null;
    if (body?.expiresInDays !== undefined && body.expiresInDays !== null) {
      const days = Number(body.expiresInDays);
      if (!Number.isFinite(days) || days <= 0 || days > MAX_EXPIRY_DAYS) {
        return NextResponse.json(
          { error: `'expiresInDays' must be between 1 and ${MAX_EXPIRY_DAYS}` },
          { status: 400 },
        );
      }
      expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
    }

    const { count, error: countErr } = await ctx.supabase
      .from("account_api_keys")
      .select("id", { count: "exact", head: true })
      .eq("account_id", ctx.accountId)
      .is("revoked_at", null);

    if (countErr) {
      console.error("[POST /api/account/api-keys] count error:", countErr);
      return NextResponse.json({ error: "Failed to create API key" }, { status: 500 });
    }
    if ((count ?? 0) >= MAX_LIVE_KEYS) {
      return NextResponse.json(
        {
          error: `This workspace already has ${MAX_LIVE_KEYS} active API keys. Revoke one before creating another.`,
        },
        { status: 409 },
      );
    }

    const key = generateApiKey();

    const { data, error } = await ctx.supabase
      .from("account_api_keys")
      .insert({
        account_id: ctx.accountId,
        created_by_user_id: ctx.userId,
        name: rawName,
        key_prefix: key.prefix,
        key_hash: key.hash,
        scopes,
        expires_at: expiresAt,
      })
      .select(KEY_COLUMNS)
      .single();

    if (error || !data) {
      console.error("[POST /api/account/api-keys] insert error:", error);
      return NextResponse.json({ error: "Failed to create API key" }, { status: 500 });
    }

    return NextResponse.json(
      {
        key: data,
        // Plaintext payload — visible to the admin exactly once.
        secret: key.secret,
      },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
