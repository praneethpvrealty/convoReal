import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runConversationSweep } from '@/lib/sweep/run';

/**
 * Conversation sweep cron — reads back over the last 24 hours of every
 * active account's WhatsApp, files what it learned onto the records,
 * and raises what was dropped as gaps a human sees at 6am IST.
 *
 * Registered every 30 minutes rather than once at 06:00, for the same
 * reason as agent-task-digest: a run lost to a platform outage catches
 * up on the next tick instead of losing the morning. Two things make
 * that safe. `boundaryHasPassed` refuses to start before 06:00 IST, and
 * conversation_sweep_runs is an insert-as-claim ledger with a unique
 * index on (account_id, run_date) — so the second tick of the morning
 * loses the race and returns without spending a credit.
 *
 * Auth: same constant-time shared-secret check as the other digests —
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
    const result = await runConversationSweep();
    console.log('[conversation-sweep]', JSON.stringify(result));
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[conversation-sweep] run failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
