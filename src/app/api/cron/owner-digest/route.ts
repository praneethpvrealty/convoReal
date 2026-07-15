import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { sendOwnerStatusDigests } from '@/lib/owners/owner-digest'

/**
 * Owner property digest cron — messages each property owner/seller on
 * WhatsApp with the buyer activity on their listings (enquiries,
 * shortlists, scheduled site visits, showcase views) at the account's
 * chosen cadence (daily / weekly). Sends ONLY when there's new activity,
 * dedups per IST day via owner_digest_log, and respects the per-contact
 * "STOP UPDATES" opt-out.
 *
 * Registered in vercel.json (daily, 04:30 UTC = 10:00 IST — inside the
 * engine's IST morning send window). Safe to ping more often: the
 * insert-as-claim ledger makes reruns no-ops.
 *
 * Auth: same constant-time shared-secret check as cleanup-images —
 * `x-cron-secret` header OR Vercel Cron's `Authorization: Bearer`,
 * matched against AUTOMATION_CRON_SECRET or CRON_SECRET. Fails CLOSED
 * (503) when no secret is configured.
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
    const result = await sendOwnerStatusDigests()
    console.log('[owner-digest]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[owner-digest] run failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
