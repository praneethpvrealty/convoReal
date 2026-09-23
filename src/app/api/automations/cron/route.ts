import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { drainPendingExecutions } from '@/lib/automations/resume-pending';
import { checkAndSendAppointmentReminders } from '@/lib/appointments/reminder';
import { sweepAndSendBroadcasts } from '@/lib/broadcasts/sender';

/**
 * Drain due `automation_pending_executions` rows. Meant to be hit
 * on a schedule (Vercel Cron / external pinger) — requires a shared
 * secret via the `x-cron-secret` header to match
 * `AUTOMATION_CRON_SECRET`.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied = request.headers.get('x-cron-secret');
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Trigger appointment/property visit reminders 24h & 2h before events
  try {
    await checkAndSendAppointmentReminders();
  } catch (reminderErr) {
    console.error(
      '[Automation Cron] Appointment reminders check failed:',
      reminderErr
    );
  }

  // Trigger background billing reconciliation
  try {
    const admin = supabaseAdmin();
    await admin.rpc('reconcile_subscriptions');
  } catch (reconcileErr) {
    console.error(
      '[Automation Cron] Billing reconciliation failed:',
      reconcileErr
    );
  }

  // Trigger background broadcast sending & retry sweep
  try {
    await sweepAndSendBroadcasts();
  } catch (broadcastErr) {
    console.error('[Automation Cron] Broadcast sweep failed:', broadcastErr);
  }

  try {
    return NextResponse.json(await drainPendingExecutions());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
