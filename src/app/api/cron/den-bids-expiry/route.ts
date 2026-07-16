import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { denAdmin } from '@/lib/den/auth'
import { appendBidEvent } from '@/lib/den/bids'
import { DEAL_MODE_OFF_GRACE_HOURS } from '@/lib/den/costs'

/**
 * Owners Den — bid expiry sweep. Two passes over live
 * (pending/countered) bids:
 *   1. past their own expires_at → 'expired'
 *   2. on properties whose Deal Mode has been OFF for longer than the
 *      48h grace period → 'expired' (the owner was warned in the
 *      toggle-off dialog)
 * Idempotent: transitions are conditional updates, re-runs no-op.
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

  const db = denAdmin()
  const summary = { expired: 0, expiredDealModeOff: 0 }

  try {
    // Pass 1: bids past their own deadline.
    const { data: stale } = await db
      .from('property_bids')
      .update({ status: 'expired', resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .in('status', ['pending', 'countered'])
      .lt('expires_at', new Date().toISOString())
      .select('id')
    for (const bid of stale || []) {
      summary.expired++
      await appendBidEvent(db, bid.id as string, 'system', 'expired', { reason: 'deadline' })
    }

    // Pass 2: live bids on properties whose Deal Mode has been off
    // beyond the grace period.
    const graceCutoff = new Date(
      Date.now() - DEAL_MODE_OFF_GRACE_HOURS * 60 * 60 * 1000
    ).toISOString()
    const { data: offProperties } = await db
      .from('properties')
      .select('id')
      .eq('deal_mode', 'off')
      .lt('deal_mode_updated_at', graceCutoff)
      .not('deal_mode_updated_at', 'is', null)
      .limit(1000)
    const offIds = (offProperties || []).map((p) => p.id as string)
    if (offIds.length > 0) {
      const { data: orphaned } = await db
        .from('property_bids')
        .update({ status: 'expired', resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .in('status', ['pending', 'countered'])
        .in('property_id', offIds)
        .select('id')
      for (const bid of orphaned || []) {
        summary.expiredDealModeOff++
        await appendBidEvent(db, bid.id as string, 'system', 'expired', { reason: 'deal_mode_off' })
      }
    }

    console.log('[den-bids-expiry]', JSON.stringify(summary))
    return NextResponse.json(summary)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[den-bids-expiry] run failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
