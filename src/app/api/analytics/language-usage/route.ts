// ============================================================
// GET /api/analytics/language-usage
//
// Per-language demand (contacts, agents) against supply (approved
// template variants) for the caller's account.
//
// Any member can read it: it is a count of the account's own data
// with no personal detail in it, and an agent deciding whether to
// bother translating a template needs the same numbers an admin does.
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { getLanguageUsage } from '@/lib/analytics/language-usage';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const data = await getLanguageUsage(ctx.supabase, ctx.accountId);
    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
