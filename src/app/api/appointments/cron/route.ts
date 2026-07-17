import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { checkAndSendAppointmentReminders } from '@/lib/appointments/reminder'
import {
  sendAgentEventReminders,
  sendDailyScheduleDigests,
  sendOverdueNudges,
} from '@/lib/calendar/agent-reminders'
import { sendPortalExpiryReminders } from '@/lib/portals/expiry-reminders'

/**
 * Auth: constant-time check of the shared cron secret, supplied via the
 * repo-standard `x-cron-secret` header OR Vercel Cron's native
 * `Authorization: Bearer` (this job is registered in vercel.json),
 * matched against `AUTOMATION_CRON_SECRET` or `CRON_SECRET`. Fails
 * CLOSED (503) when no secret is configured.
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
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Client-facing template reminders, then the three agent-facing
    // passes: pre-event brief, morning digest, overdue nudge.
    await checkAndSendAppointmentReminders()
    await sendAgentEventReminders()
    await sendDailyScheduleDigests()
    await sendOverdueNudges()
    await sendPortalExpiryReminders()
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Appointments Cron] Check failed:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}
