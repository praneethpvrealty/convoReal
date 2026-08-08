import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { sweepAndSendBroadcasts } from '@/lib/broadcasts/sender';

/**
 * Broadcast dispatch safety net.
 *
 * A broadcast is sent by a background promise started from the POST
 * that created it. When the serverless function holding that promise is
 * reclaimed mid-loop, the recipients it had not reached yet stay
 * 'pending' and the broadcast stays 'sending' — with nothing to pick it
 * back up, a batch simply stops partway through and looks delivered.
 *
 * sweepAndSendBroadcasts() was written for exactly this and was only
 * reachable from /api/automations/cron, which is not scheduled. It is
 * given its own route rather than scheduling that one, because that
 * route also drains automations, appointment reminders and billing
 * reconciliation — switching those on as a side effect of fixing
 * broadcasts would fire whatever backlog has accumulated.
 *
 * Idempotent and safe to run often: it only picks up broadcasts still
 * marked 'sending', sends to recipients still 'pending' or due for
 * retry, and caps itself well inside the gateway timeout. Re-running
 * never re-sends to someone already marked 'sent'.
 *
 * Auth: same constant-time shared-secret check as the other crons.
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
    await sweepAndSendBroadcasts();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[broadcast-sweep] run failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
