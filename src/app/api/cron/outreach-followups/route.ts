import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { sweepDueOutreachFollowups } from '@/lib/outreach/dispatcher';

/**
 * Post-call follow-up sweep — the long game behind `not_now`
 * (docs/post-call-followup-plan.md §4). Sends every pending
 * outreach_followups row whose `scheduled_for` has arrived, through
 * the same gates as the immediate sends: do-not-call, the 24-hour
 * window, and the Utility opener when the window is shut. Safe to run
 * more often than scheduled — a row leaves `pending` on its first
 * send and is never picked up again.
 *
 * Registered in vercel.json (hourly at :25). Auth: same constant-time
 * shared-secret check as the other crons — `x-cron-secret` header OR
 * Vercel Cron's `Authorization: Bearer`, matched against
 * AUTOMATION_CRON_SECRET or CRON_SECRET. Fails CLOSED (503) when no
 * secret is configured.
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
    const result = await sweepDueOutreachFollowups();
    console.log('[outreach-followups]', JSON.stringify(result));
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[outreach-followups] run failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
