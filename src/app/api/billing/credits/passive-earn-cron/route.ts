import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { payoutPassiveEarnAll } from '@/lib/credits/referral';

// GET /api/billing/credits/passive-earn-cron
// Runs monthly (e.g. 1st of each month). Pays 10% of each converted
// referral's monthly grant to the referrer, up to 12 months.
// Idempotent via passive_earn_months on each referrals row.
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied = request.headers.get('x-cron-secret') || '';
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (suppliedBuf.length !== expectedBuf.length || !timingSafeEqual(suppliedBuf, expectedBuf)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await payoutPassiveEarnAll();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[Passive Earn Cron] failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
