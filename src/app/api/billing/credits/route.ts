import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { getOrCreateWallet } from '@/lib/credits/wallet';
import { deriveCreditStatus } from '@/lib/credits/types';

// GET /api/billing/credits — current wallet snapshot for the caller's account.
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const wallet = await getOrCreateWallet(ctx.accountId, ctx.supabase);

    return NextResponse.json({
      total: wallet.total_credits,
      monthly: wallet.monthly_credits,
      bonus: wallet.bonus_credits,
      referral: wallet.referral_credits,
      purchased: wallet.purchased_credits,
      promo: wallet.promo_credits,
      pendingReferral: wallet.pending_referral_credits,
      monthlyResetAt: wallet.monthly_reset_at,
      status: deriveCreditStatus(wallet.total_credits),
      referralCode: wallet.referral_code,
      referralTier: wallet.referral_tier,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
