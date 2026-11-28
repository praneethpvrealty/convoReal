import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  sweepConsentReminders,
  sweepConsentTimeouts,
} from '@/lib/inventory/location-requests';
import {
  sweepReferredEnquiryReminders,
  sweepReferredEnquiryTimeouts,
} from '@/lib/showcase/referred-enquiries';

/**
 * Location-request consent sweep — a co-broker asked to consent to a
 * location reveal has four daytime hours to answer (the clock stops in
 * the account's client quiet hours) and is reminded halfway; past that
 * the request moves to the listing side's queue marked as stalled.
 * An agent asked to approve a guest's enquiry (see
 * referred-enquiries.ts) gets the same clock and reminder, swept here
 * too; their timeout still closes the enquiry and points the guest
 * back to them.
 * Registered in vercel.json every 15 minutes; idempotent
 * (expired rows leave the pending state, so reruns are no-ops).
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
    const reminded = await sweepConsentReminders(supabaseAdmin());
    const expired = await sweepConsentTimeouts(supabaseAdmin());
    const referredReminded =
      await sweepReferredEnquiryReminders(supabaseAdmin());
    const referredExpired = await sweepReferredEnquiryTimeouts(supabaseAdmin());
    if (
      reminded > 0 ||
      expired > 0 ||
      referredReminded > 0 ||
      referredExpired > 0
    )
      console.log(
        `[location-request-timeouts] reminded=${reminded} expired=${expired} referredReminded=${referredReminded} referred=${referredExpired}`
      );
    return NextResponse.json({
      reminded,
      expired,
      referredReminded,
      referredExpired,
    });
  } catch (err) {
    console.error('[location-request-timeouts] sweep failed:', err);
    return NextResponse.json({ error: 'sweep failed' }, { status: 500 });
  }
}
