// ============================================================
// Owners Den — server-side auth context.
//
// The Den mirror of src/lib/auth/account.ts, for the property-owner
// persona. A Den user is an auth.users row with NO profiles row
// (migration 131) — every CRM RLS policy denies them by construction.
// Their data access happens exclusively through /api/den/* handlers,
// which resolve a DenContext here and then query with the
// service-role client under EXPLICIT owner scoping:
//
//   export const GET = withDenAuth(async (ctx, req) => {
//     const propertyIds = await resolveOwnerPropertyIds(ctx);
//     ...
//   });
//
// Never hand the service-role client's results to the response
// without filtering through ctx.links / resolveOwnerPropertyIds —
// that scoping IS the security boundary for Den routes (proxy.ts
// fails open by design, same as the staff surface).
// ============================================================

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { UnauthorizedError, toErrorResponse } from "@/lib/auth/account";

/**
 * Thrown when the caller has a valid Supabase session but is not a
 * completed Den user yet — either their phone is unverified (Google
 * sign-in without the mandatory WhatsApp verification) or
 * /api/den/auth/complete hasn't run. Clients redirect to
 * /den/verify-phone on the `phone_unverified` code.
 */
export class PhoneUnverifiedError extends Error {
  readonly status = 403 as const;
  readonly code = "phone_unverified" as const;
  constructor(message = "WhatsApp phone verification required") {
    super(message);
    this.name = "PhoneUnverifiedError";
  }
}

export function toDenErrorResponse(err: unknown): NextResponse {
  if (err instanceof PhoneUnverifiedError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  return toErrorResponse(err);
}

let _admin: SupabaseClient | null = null;
/** Service-role client for Den routes. Bypasses RLS — every query
 *  built on it MUST be scoped through the caller's DenContext. */
export function denAdmin(): SupabaseClient {
  if (!_admin) {
    _admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _admin;
}

export interface DenContactLink {
  linkId: string;
  accountId: string;
  contactId: string;
  /** Managing agency's display name — shown as "managed by …" in the Den. */
  agencyName: string | null;
}

export interface DenContext {
  /** auth.uid() of the caller. */
  userId: string;
  /** den_users.id */
  denUserId: string;
  /** Verified WhatsApp phone (as stored at completion time). */
  phone: string;
  displayName: string | null;
  notifyMatches: boolean;
  notifyBids: boolean;
  digestFrequency: "off" | "daily" | "weekly";
  /** Active links to tenant-scoped owner contacts. May be empty for a
   *  brand-new owner with no listings yet. */
  links: DenContactLink[];
}

/**
 * Resolve the calling Den user. Throws `UnauthorizedError` without a
 * session, `PhoneUnverifiedError` when the session exists but the Den
 * identity was never completed (no den_users row).
 */
export async function getDenContext(): Promise<DenContext> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    throw new UnauthorizedError();
  }

  const db = denAdmin();
  const { data: denUser, error } = await db
    .from("den_users")
    .select("id, phone, display_name, notify_matches, notify_bids, digest_frequency")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[getDenContext] den_users fetch error:", error);
    throw new UnauthorizedError("Could not load Owners Den context");
  }
  if (!denUser) {
    throw new PhoneUnverifiedError();
  }

  const { data: linkRows } = await db
    .from("den_contact_links")
    .select("id, account_id, contact_id, account:accounts(id, name)")
    .eq("den_user_id", denUser.id)
    .eq("status", "active");

  const links: DenContactLink[] = (linkRows || []).map((row) => {
    const account = Array.isArray(row.account) ? row.account[0] : row.account;
    return {
      linkId: row.id as string,
      accountId: row.account_id as string,
      contactId: row.contact_id as string,
      agencyName: (account as { name?: string } | null)?.name ?? null,
    };
  });

  return {
    userId: user.id,
    denUserId: denUser.id as string,
    phone: denUser.phone as string,
    displayName: (denUser.display_name as string | null) ?? null,
    notifyMatches: Boolean(denUser.notify_matches),
    notifyBids: Boolean(denUser.notify_bids),
    digestFrequency: (denUser.digest_frequency as "off" | "daily" | "weekly") ?? "weekly",
    links,
  };
}

/**
 * The properties this Den user owns, via owner_contact_id across all
 * linked accounts. Every /api/den property route funnels through this
 * — it is the Den's row-level scoping.
 */
export async function resolveOwnerPropertyIds(ctx: DenContext): Promise<string[]> {
  if (ctx.links.length === 0) return [];
  const db = denAdmin();
  const { data, error } = await db
    .from("properties")
    .select("id")
    .in("owner_contact_id", ctx.links.map((l) => l.contactId));
  if (error) {
    console.error("[resolveOwnerPropertyIds] query error:", error);
    return [];
  }
  return (data || []).map((row) => row.id as string);
}

type DenHandler = (ctx: DenContext, req: NextRequest, routeCtx: { params: Promise<Record<string, string>> }) => Promise<NextResponse>;

/**
 * Wrapper every /api/den route uses so none can forget the auth
 * check. Mirrors the requireRole/try-catch convention of staff routes.
 */
export function withDenAuth(handler: DenHandler) {
  return async (req: NextRequest, routeCtx: { params: Promise<Record<string, string>> }): Promise<NextResponse> => {
    try {
      const ctx = await getDenContext();
      return await handler(ctx, req, routeCtx);
    } catch (err) {
      return toDenErrorResponse(err);
    }
  };
}
