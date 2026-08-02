import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { sendBuyerMatchDigests } from '@/lib/buyer/digest-sender';

/**
 * Buyer match digest cron — messages each opted-in buyer on WhatsApp
 * with the listings that fit the brief they gave an agency, ranked by
 * the same engine behind /buyer/matches.
 *
 * Consent-first (declined never, pending asked once inside an open
 * window, granted sends), deduped per IST day via
 * buyer_match_digest_log, and no listing is sent to the same buyer
 * twice within a month. Safe to ping more often than scheduled: the
 * insert-as-claim ledger makes reruns no-ops.
 *
 * Registered in vercel.json (daily, 05:45 UTC = 11:15 IST — late
 * enough that the morning's new listings are in, and after the
 * deal-mode sweep so its cross-tenant matches are already recorded).
 *
 * Auth: same constant-time shared-secret check as the other crons —
 * `x-cron-secret` header OR Vercel Cron's `Authorization: Bearer`,
 * matched against AUTOMATION_CRON_SECRET or CRON_SECRET. Fails CLOSED
 * (503) when no secret is configured.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET || process.env.CRON_SECRET;
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
    const result = await sendBuyerMatchDigests();
    console.log('[buyer-match-digest]', JSON.stringify(result));
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[buyer-match-digest] run failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
