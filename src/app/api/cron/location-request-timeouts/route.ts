import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sweepConsentTimeouts } from '@/lib/inventory/location-requests'

/**
 * Location-request consent timeout sweep — a co-broker asked to consent
 * to a location reveal has 2 hours to answer; past that the request
 * expires and the seeker is redirected to the person who shared them
 * the property. Registered in vercel.json every 15 minutes; idempotent
 * (expired rows leave the pending state, so reruns are no-ops).
 *
 * Auth: same constant-time shared-secret check as the other crons.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET || process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied =
    request.headers.get('x-cron-secret') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (suppliedBuf.length !== expectedBuf.length || !timingSafeEqual(suppliedBuf, expectedBuf)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const expired = await sweepConsentTimeouts(supabaseAdmin())
    if (expired > 0) console.log(`[location-request-timeouts] expired=${expired}`)
    return NextResponse.json({ expired })
  } catch (err) {
    console.error('[location-request-timeouts] sweep failed:', err)
    return NextResponse.json({ error: 'sweep failed' }, { status: 500 })
  }
}
