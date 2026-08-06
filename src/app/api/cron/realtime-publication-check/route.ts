import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { checkRealtimePublication } from '@/lib/realtime/publication-health'

/**
 * Realtime publication check — asserts that every table the web and
 * mobile clients subscribe to is still a member of supabase_realtime
 * (src/lib/realtime/publication-health.ts).
 *
 * A publication is a database-level object, so it does not survive a
 * schema-scoped dump/restore. The ap-south-1 rehost dropped every table
 * from it and nothing anywhere reported a problem: channels still
 * subscribed and reported connected, they just never received an event.
 * The Inbox looked healthy and silently stopped updating until a user
 * noticed. This turns that into a failing cron.
 *
 * Responds 500 when tables are missing so the run shows as failed in
 * Vercel's cron history rather than logging into the void.
 *
 * Registered in vercel.json (daily at 02:40 UTC). Read-only.
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
    const health = await checkRealtimePublication()
    if (!health.ok) {
      console.error(
        '[realtime-publication-check] tables missing from supabase_realtime:',
        health.missing.join(', '),
        '— realtime is dead for these; re-run supabase/migrations/207_restore_realtime_publication.sql',
      )
      return NextResponse.json(health, { status: 500 })
    }
    return NextResponse.json(health, { status: 200 })
  } catch (err) {
    const error = err as Error
    console.error('[realtime-publication-check] failed:', error)
    return NextResponse.json({ error: error.message || 'Check failed' }, { status: 500 })
  }
}
