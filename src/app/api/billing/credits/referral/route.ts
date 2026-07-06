import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { getOrCreateWallet } from '@/lib/credits/wallet';

// GET /api/billing/credits/referral — referral hub data. Visible to
// all team members (read-only), same as the wallet itself.
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const wallet = await getOrCreateWallet(ctx.accountId, ctx.supabase);

    const { data: referrals, error } = await ctx.supabase
      .from('referrals')
      .select('*')
      .eq('referrer_account_id', ctx.accountId)
      .order('signed_up_at', { ascending: false });

    if (error) {
      console.error('[GET /api/billing/credits/referral] query error:', error);
      return NextResponse.json({ error: 'Failed to load referral data' }, { status: 500 });
    }

    const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const passiveEarnTotal = (referrals ?? [])
      .filter((r) => r.status === 'converted')
      .reduce((sum, r) => sum + r.passive_earn_months, 0);

    return NextResponse.json({
      referralCode: wallet.referral_code,
      referralLink: `${baseUrl}/signup?ref=${wallet.referral_code}`,
      tier: wallet.referral_tier,
      paidReferralCount: wallet.paid_referral_count,
      pendingReferralCredits: wallet.pending_referral_credits,
      referrals: referrals ?? [],
      passiveEarnMonthsTotal: passiveEarnTotal,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
