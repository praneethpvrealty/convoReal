import { NextResponse } from 'next/server';
import { expireStaleCredits } from '@/lib/credits/expiry';

// GET /api/billing/credits/expire-credits-cron
// Runs daily. Expires referral/promo/admin-grant credits past their
// expires_at (monthly and commitment-bonus buckets expire via the
// next grant call instead — see expiry.ts's doc comment).
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
    const result = await expireStaleCredits();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[Expire Credits Cron] failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
