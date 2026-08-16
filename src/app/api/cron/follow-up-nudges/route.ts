import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { sendFollowUpNudges } from '@/lib/contacts/follow-up-nudges';
import { sendClosingDealNudges } from '@/lib/journey/closing-nudges';

/**
 * Follow-up radar cron — cards each account's routed agent on WhatsApp
 * about HOT leads gone quiet (48h+ silence), with Check in / Snooze /
 * Mark cold buttons. Per-lead state in follow_up_nudges caps this at
 * one card per lead per week, so reruns are no-ops.
 *
 * The same run sends the closing card: deals already at legal, which
 * the radar deliberately skips, carded instead when their journey stage
 * has not moved in a fortnight. One cron because the two are one job —
 * "what needs chasing today" — split only by which half of the funnel
 * the relationship sits in.
 *
 * Registered in vercel.json (daily, 04:15 UTC = 09:45 IST — inside the
 * engine's IST morning send window, before the digests).
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
    const result = await sendFollowUpNudges();
    console.log('[follow-up-nudges]', JSON.stringify(result));
    // Run after the radar rather than alongside it: both send WhatsApp
    // cards to the same agents, and a serial run keeps one account's
    // burst inside Meta's per-number pacing.
    const closing = await sendClosingDealNudges();
    console.log('[closing-nudges]', JSON.stringify(closing));
    return NextResponse.json({ ...result, closing });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[follow-up-nudges] run failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
