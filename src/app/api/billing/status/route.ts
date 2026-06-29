import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { getPlanLimits } from '@/lib/billing/gates';

// GET /api/billing/status
// Returns current plan, limits, and usage counts for the account.
// Owner-only — billing is account-level, not per-user.
export async function GET() {
  try {
    const ctx = await requireRole('owner');

    const [limits, contactsRes, propertiesRes, usersRes, subRes] = await Promise.all([
      getPlanLimits(ctx),
      ctx.supabase
        .from('contacts')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId),
      ctx.supabase
        .from('properties')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId),
      ctx.supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId),
      ctx.supabase
        .from('subscriptions')
        .select('*')
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
    ]);

    return NextResponse.json({
      subscription: subRes.data ?? null,
      limits,
      usage: {
        contacts: contactsRes.count ?? 0,
        properties: propertiesRes.count ?? 0,
        users: usersRes.count ?? 0,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
