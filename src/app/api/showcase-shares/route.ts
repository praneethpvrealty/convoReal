import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

// POST /api/showcase-shares
// Mints a share-instance token for the generic showcase link. The
// client appends it as ?s=<id>; the public beacon stamps matching
// events with it so Pulse can attribute anonymous visits to "the link
// you shared <when>" (migration 173). Callers treat minting as
// best-effort — a failed mint falls back to the plain link, never a
// blocked share.
export async function POST() {
  try {
    const ctx = await requireRole('agent');

    const limit = checkRateLimit(`showcase-shares:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { data, error } = await ctx.supabase
      .from('showcase_share_links')
      .insert({ account_id: ctx.accountId, user_id: ctx.userId })
      .select('id')
      .single();
    if (error) throw error;

    return NextResponse.json({ data: { id: data.id } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
