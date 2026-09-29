// ============================================================
// /api/account
//
//   GET   — current caller's account + role. Any member.
//   PATCH — rename the account, set its default outbound
//           language and/or its journey compartment
//           scope.                                Admin+.
//
// Why both verbs share a route file
//   They speak about the same singular resource (the caller's
//   account) and reuse the same `requireRole` plumbing. Splitting
//   them across files would duplicate the `account_id` lookup
//   without buying anything.
// ============================================================

import { NextResponse } from "next/server";

import {
  requireRole,
  getCurrentAccount,
  toErrorResponse,
} from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { isLanguageCode, LANGUAGE_CODES, type LanguageCode } from "@/lib/languages";
import {
  isJourneyCompartmentScope,
  JOURNEY_COMPARTMENT_SCOPES,
  type JourneyCompartmentScope,
} from "@/lib/journey/compartments";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    return NextResponse.json({
      account: ctx.account,
      role: ctx.role,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const MAX_NAME_LEN = 80;

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");

    // Per-user limit on admin-class mutations. Bounds accidental
    // abuse (script run in a loop) and a compromised admin session
    // spamming renames. Each admin endpoint keys its own bucket so
    // one route doesn't starve another.
    const limit = await checkRateLimit(
      `admin:rename:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | {
          name?: unknown;
          default_language?: unknown;
          journey_compartment_scope?: unknown;
        }
      | null;

    // Both fields are optional, but sending neither is a no-op the
    // caller almost certainly didn't intend — reject rather than
    // report success for an update that changed nothing.
    const wantsName = body?.name !== undefined;
    const wantsLanguage = body?.default_language !== undefined;
    const wantsCompartmentScope =
      body?.journey_compartment_scope !== undefined;
    if (!wantsName && !wantsLanguage && !wantsCompartmentScope) {
      return NextResponse.json(
        {
          error:
            "Provide 'name', 'default_language' or 'journey_compartment_scope'",
        },
        { status: 400 },
      );
    }

    const patch: {
      name?: string;
      default_language?: LanguageCode;
      journey_compartment_scope?: JourneyCompartmentScope;
    } = {};

    if (wantsName) {
      const rawName = body?.name;
      if (typeof rawName !== "string") {
        return NextResponse.json(
          { error: "'name' must be a string" },
          { status: 400 },
        );
      }

      const name = rawName.trim();
      if (name.length === 0) {
        return NextResponse.json(
          { error: "Account name cannot be empty" },
          { status: 400 },
        );
      }
      if (name.length > MAX_NAME_LEN) {
        return NextResponse.json(
          { error: `Account name must be ${MAX_NAME_LEN} characters or fewer` },
          { status: 400 },
        );
      }
      patch.name = name;
    }

    if (wantsLanguage) {
      // Rejected rather than coerced to English: silently downgrading
      // a language the caller asked for would look like it saved.
      if (!isLanguageCode(body?.default_language)) {
        return NextResponse.json(
          { error: `'default_language' must be one of: ${LANGUAGE_CODES.join(", ")}` },
          { status: 400 },
        );
      }
      patch.default_language = body.default_language;
    }

    if (wantsCompartmentScope) {
      if (!isJourneyCompartmentScope(body?.journey_compartment_scope)) {
        return NextResponse.json(
          {
            error: `'journey_compartment_scope' must be one of: ${JOURNEY_COMPARTMENT_SCOPES.join(", ")}`,
          },
          { status: 400 },
        );
      }
      patch.journey_compartment_scope = body.journey_compartment_scope;
    }

    // RLS allows this UPDATE because accounts_update requires
    // `is_account_member(id, 'admin')`, and requireRole already
    // guaranteed the caller is admin+.
    const { data, error } = await ctx.supabase
      .from("accounts")
      .update(patch)
      .eq("id", ctx.accountId)
      .select("id, name, default_language, journey_compartment_scope")
      .single();

    if (error) {
      console.error("[PATCH /api/account] update error:", error);
      return NextResponse.json(
        { error: "Failed to update account" },
        { status: 500 },
      );
    }

    return NextResponse.json({ account: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
