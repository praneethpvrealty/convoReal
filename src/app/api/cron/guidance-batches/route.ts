import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import {
  CRON_BUILD_BUDGET_MS,
  pollGuidanceBatches,
  queueGuidanceBatches,
  type QueueResult,
} from '@/lib/guidance-value/batch';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const maxDuration = 300;

// Collects finished Gemini batches of guidance value notifications, saves
// their rates, then keeps queuing notifications an admin asked to batch
// that one time-limited queue request did not reach. Auth matches the other cron routes: the shared
// secret via `x-cron-secret` or Vercel Cron's `Authorization: Bearer`,
// failing closed when no secret is configured.
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
    const polled = await pollGuidanceBatches(db);
    let queued: QueueResult | { error: string } | null = null;
    try {
      queued = await queueGuidanceBatches(db, Date.now, {
        requestedOnly: true,
        budgetMs: CRON_BUILD_BUDGET_MS,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[guidance-value] background queue failed:', message);
      queued = { error: message };
    }
    return NextResponse.json({ data: { polled, queued } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[guidance-value] batch poll failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
