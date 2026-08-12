import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { toGateStatsMap } from '@/lib/inventory/gate-stats';

// GET /api/properties/gate-stats
//
// Per-listing confidential-gate rollup for the caller's account, keyed
// by property id. One RPC for the whole grid rather than a count per
// card (AGENTS.md §2.6), and the function returns only gated listings
// or ones with history, so an account with a single confidential
// listing does not pay for hundreds of rows of zeroes.
//
// Uses the caller's RLS client: property_gate_stats is SECURITY DEFINER
// and guards on is_account_member(), so another brokerage's demand
// signal is not reachable by passing a different id — there is no id to
// pass, it is taken from the session.
export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase.rpc('property_gate_stats', {
      target_account_id: ctx.accountId,
    });

    if (error) {
      console.error('[GET /api/properties/gate-stats] RPC error:', error);
      return NextResponse.json(
        { error: 'Failed to load gate stats' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: toGateStatsMap(data) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
