// ============================================================
// Buyer portal — server-side auth context.
//
// The buyer mirror of src/lib/den/auth.ts, for the property-buyer
// persona. A buyer user is an auth.users row with NO profiles row
// (migration 160) — every CRM RLS policy denies them by construction.
// Their data access happens exclusively through /api/buyer/* handlers,
// which resolve a BuyerContext here and then query with the
// service-role client under EXPLICIT scoping:
//
//   export const GET = withBuyerAuth(async (ctx, req) => { ... });
//
// Never hand the service-role client's results to the response
// without filtering through ctx.links / the buyer's shortlist rows —
// that scoping IS the security boundary for buyer routes.
// ============================================================

import { NextResponse, type NextRequest } from 'next/server';
import {
  createClient as createAdminClient,
  type SupabaseClient,
} from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';
import { UnauthorizedError, toErrorResponse } from '@/lib/auth/account';

/**
 * Thrown when the caller has a valid Supabase session but is not a
 * completed buyer user yet — either their phone is unverified (Google
 * sign-in without the mandatory WhatsApp verification) or
 * /api/buyer/auth/complete hasn't run. Clients redirect to
 * /buyer/verify-phone on the `phone_unverified` code.
 */
export class BuyerPhoneUnverifiedError extends Error {
  readonly status = 403 as const;
  readonly code = 'phone_unverified' as const;
  constructor(message = 'WhatsApp phone verification required') {
    super(message);
    this.name = 'BuyerPhoneUnverifiedError';
  }
}

export function toBuyerErrorResponse(err: unknown): NextResponse {
  if (err instanceof BuyerPhoneUnverifiedError) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.status }
    );
  }
  return toErrorResponse(err);
}

let _admin: SupabaseClient | null = null;
/** Service-role client for buyer routes. Bypasses RLS — every query
 *  built on it MUST be scoped through the caller's BuyerContext. */
export function buyerAdmin(): SupabaseClient {
  if (!_admin) {
    _admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _admin;
}

export interface BuyerContactLink {
  linkId: string;
  accountId: string;
  contactId: string;
  /** Managing agency's display name — shown as "with …" in the portal. */
  agencyName: string | null;
}

export interface BuyerContext {
  /** auth.uid() of the caller. */
  userId: string;
  /** buyer_users.id */
  buyerUserId: string;
  /** Verified WhatsApp phone (as stored at completion time). */
  phone: string;
  displayName: string | null;
  notifyMatches: boolean;
  /** Active links to tenant-scoped buyer contacts. May be empty for a
   *  brand-new buyer with no inquiries yet. */
  links: BuyerContactLink[];
}

/**
 * Resolve the calling buyer user. Throws `UnauthorizedError` without a
 * session, `BuyerPhoneUnverifiedError` when the session exists but the
 * buyer identity was never completed (no buyer_users row).
 */
export async function getBuyerContext(): Promise<BuyerContext> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    throw new UnauthorizedError();
  }

  const db = buyerAdmin();
  const { data: buyerUser, error } = await db
    .from('buyer_users')
    .select('id, phone, display_name, notify_matches')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (error) {
    console.error('[getBuyerContext] buyer_users fetch error:', error);
    throw new UnauthorizedError('Could not load buyer portal context');
  }
  if (!buyerUser) {
    throw new BuyerPhoneUnverifiedError();
  }

  const { data: linkRows } = await db
    .from('buyer_contact_links')
    .select('id, account_id, contact_id, account:accounts(id, name)')
    .eq('buyer_user_id', buyerUser.id)
    .eq('status', 'active');

  const links: BuyerContactLink[] = (linkRows || []).map((row) => {
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
    buyerUserId: buyerUser.id as string,
    phone: buyerUser.phone as string,
    displayName: (buyerUser.display_name as string | null) ?? null,
    notifyMatches: Boolean(buyerUser.notify_matches),
    links,
  };
}

type BuyerHandler = (
  ctx: BuyerContext,
  req: NextRequest,
  routeCtx: { params: Promise<Record<string, string>> }
) => Promise<NextResponse>;

/**
 * Wrapper every /api/buyer route uses so none can forget the auth
 * check. Mirrors withDenAuth.
 */
export function withBuyerAuth(handler: BuyerHandler) {
  return async (
    req: NextRequest,
    routeCtx: { params: Promise<Record<string, string>> }
  ): Promise<NextResponse> => {
    try {
      const ctx = await getBuyerContext();
      return await handler(ctx, req, routeCtx);
    } catch (err) {
      return toBuyerErrorResponse(err);
    }
  };
}
