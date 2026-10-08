import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { processHotViewerAlerts } from '@/lib/showcase/hot-viewers';
import { processShowcaseViewNudges } from '@/lib/showcase/view-nudges';

/**
 * Showcase view check-ins — asks an identified visitor who spent time on
 * a listing whether they want a visit, a call back, or something else,
 * and alerts the agent about visitors who are hot on a listing.
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
    const db = supabaseAdmin();
    const hotViewerAlerts = await processHotViewerAlerts(db);
    const totals = await processShowcaseViewNudges(db);
    if (totals.sent + totals.skipped + totals.failed + hotViewerAlerts > 0) {
      console.log(
        `[showcase-view-nudges] sent=${totals.sent} skipped=${totals.skipped} failed=${totals.failed} hot=${hotViewerAlerts}`
      );
    }
    return NextResponse.json({ ...totals, hotViewerAlerts });
  } catch (err) {
    console.error('[showcase-view-nudges] processing failed:', err);
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
}
