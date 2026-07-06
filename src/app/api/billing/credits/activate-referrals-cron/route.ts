import { NextResponse } from 'next/server';
import { processUnclaimedReferralSignups, activatePendingReferrals } from '@/lib/credits/referral';

// GET /api/billing/credits/activate-referrals-cron
// Runs daily. First reconciles any signups whose referral row wasn't
// created yet (accounts.referred_by_code set but no `referrals` row
// — see processUnclaimedReferralSignups' doc comment), then promotes
// any referral past its 7-day activation window.
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied = request.headers.get('x-cron-secret');
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const reconciled = await processUnclaimedReferralSignups();
    const activated = await activatePendingReferrals();
    return NextResponse.json({ success: true, reconciled, activated });
  } catch (error) {
    console.error('[Referral Activation Cron] failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
