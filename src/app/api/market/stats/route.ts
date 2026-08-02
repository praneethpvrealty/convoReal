import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';

function monthsBackStart(months: number): string {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1)
  );
  return start.toISOString().slice(0, 10);
}

// GET /api/market/stats
// Consent-gated read of the anonymized market_stats rollups (the
// "Market Pulse" read path anticipated by migration 111): market_stats
// carries RLS with no policies, so reads happen here through the
// service-role client, and only for accounts that have themselves
// opted into data sharing (give-to-get).
export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data: account, error: accountError } = await ctx.supabase
      .from('accounts')
      .select('data_sharing_consent')
      .eq('id', ctx.accountId)
      .maybeSingle();
    if (accountError) throw accountError;

    const isOwner = ctx.role === 'owner';
    if (!account?.data_sharing_consent) {
      return NextResponse.json({
        consent: false,
        isOwner,
        supply: [],
        demand: [],
        own: [],
      });
    }

    const admin = supabaseAdmin();
    const since = monthsBackStart(12);

    const [supplyRes, demandRes, ownRes] = await Promise.all([
      admin
        .from('market_stats')
        .select(
          'period_month, city, locality, property_type, listing_type, listings_count, median_price, median_area_sqft, sold_count, median_sold_price, median_days_to_sell, accounts_count'
        )
        .eq('side', 'supply')
        .gte('period_month', since)
        .order('period_month', { ascending: true })
        .limit(5000),
      admin
        .from('market_stats')
        .select(
          'period_month, locality, property_type, buyer_count, median_budget, accounts_count'
        )
        .eq('side', 'demand')
        .gte('period_month', since)
        .order('period_month', { ascending: true })
        .limit(5000),
      ctx.supabase.rpc('account_locality_medians', {
        p_account_id: ctx.accountId,
      }),
    ]);

    if (supplyRes.error || demandRes.error) {
      console.error(
        '[GET /api/market/stats] query error:',
        supplyRes.error ?? demandRes.error
      );
      return NextResponse.json(
        { error: 'Failed to load market stats' },
        { status: 500 }
      );
    }
    if (ownRes.error) {
      console.error('[GET /api/market/stats] own medians error:', ownRes.error);
    }

    return NextResponse.json({
      consent: true,
      isOwner,
      supply: supplyRes.data ?? [],
      demand: demandRes.data ?? [],
      own: ownRes.data ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
