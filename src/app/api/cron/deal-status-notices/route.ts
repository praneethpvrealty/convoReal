import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { drainDealStatusNoticesForConnectedAccounts } from '@/lib/deals/status-notices';

/**
 * Deal status notices cron — for every connected account, completes the
 * open todos whose deal closed, journey branch dropped or property left
 * the market, then sends the counterpart notices the database triggers
 * queued in `deal_status_notifications`.
 *
 * Registered in vercel.json every 15 minutes. Quiet hours and a closed
 * 24-hour session leave a row pending for the next run; a failed send
 * waits an hour between attempts and gives up after three.
 *
 * Auth: same constant-time shared-secret check as owner-digest —
 * `x-cron-secret` header OR Vercel Cron's `Authorization: Bearer`,
 * matched against AUTOMATION_CRON_SECRET or CRON_SECRET. Fails CLOSED
 * (503) when no secret is configured.
 */
export async function GET(request: Request) {
  const expected =
    process.env.AUTOMATION_CRON_SECRET || process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied =
    request.headers.get('x-cron-secret') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    '';
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result =
      await drainDealStatusNoticesForConnectedAccounts(supabaseAdmin());
    console.log('[deal-status-notices]', JSON.stringify(result));
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[deal-status-notices] run failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
