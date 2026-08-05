import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { reconcileLeadLedger } from '@/lib/leads/ledger-reconcile'

/**
 * Lead-sync reconcile cron — compares the Cloudflare email worker's
 * ledger of received lead emails against email_sync_logs, re-ingests
 * anything the push path dropped, and alerts the account owner when
 * healing was needed (src/lib/leads/ledger-reconcile.ts).
 *
 * Registered in vercel.json (hourly at :10, offset from the
 * every-15-minute crons). Safe to ping more often: entries already
 * logged are only marked delivered, never reprocessed.
 *
 * Auth: same constant-time shared-secret check as the other crons —
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
    const result = await reconcileLeadLedger()
    console.log('[lead-sync-reconcile]', JSON.stringify(result))
    return NextResponse.json(result, { status: result.status === 'worker_unreachable' ? 502 : 200 })
  } catch (err) {
    const error = err as Error
    console.error('[lead-sync-reconcile] failed:', error)
    return NextResponse.json({ error: error.message || 'Reconcile failed' }, { status: 500 })
  }
}
