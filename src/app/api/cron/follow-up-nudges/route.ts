import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { sendFollowUpNudges } from '@/lib/contacts/follow-up-nudges';

/**
 * Follow-up radar cron — cards each account's routed agent on WhatsApp
 * about HOT leads gone quiet (48h+ silence), with Check in / Snooze /
 * Mark cold buttons. Per-lead state in follow_up_nudges caps this at
 * one card per lead per week, so reruns are no-ops.
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
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[follow-up-nudges] run failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
