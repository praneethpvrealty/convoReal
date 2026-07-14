import { NextResponse } from 'next/server'
import { checkAndSendAppointmentReminders } from '@/lib/appointments/reminder'
import {
  sendAgentEventReminders,
  sendDailyScheduleDigests,
  sendOverdueNudges,
} from '@/lib/calendar/agent-reminders'

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret')
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Client-facing template reminders, then the three agent-facing
    // passes: pre-event brief, morning digest, overdue nudge.
    await checkAndSendAppointmentReminders()
    await sendAgentEventReminders()
    await sendDailyScheduleDigests()
    await sendOverdueNudges()
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Appointments Cron] Check failed:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}
