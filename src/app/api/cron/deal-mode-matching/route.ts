import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { denAdmin } from '@/lib/den/auth'
import { runDealModeSweep } from '@/lib/den/matching-sweep'

/**
 * Owners Den — Deal Mode matching sweep cron. Matches every published
 * deal_mode property against every other tenant's Buyer/Agent
 * contacts and records masked match_events in the buyers' accounts
 * (aggressive properties additionally WhatsApp-ping newly matched
 * buyers). Re-runs are cheap: live events refresh in place, and
 * sent/dismissed events suppress re-creation for 7 days.
 *
 * Auth: same constant-time shared-secret check as the other crons —
 * `x-cron-secret` header OR `Authorization: Bearer`, matched against
 * AUTOMATION_CRON_SECRET or CRON_SECRET. Fails CLOSED (503) when no
 * secret is configured.
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
    const summary = await runDealModeSweep(denAdmin())
    console.log('[deal-mode-matching]', JSON.stringify(summary))
    return NextResponse.json(summary)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[deal-mode-matching] run failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
