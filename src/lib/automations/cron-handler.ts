import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  drainPendingExecutions,
  RESUME_TIME_BUDGET_MS,
} from '@/lib/automations/resume-pending';
import { checkAndSendAppointmentReminders } from '@/lib/appointments/reminder';
import { sweepAndSendBroadcasts } from '@/lib/broadcasts/sender';

export async function handleAutomationCron(
  request: Request,
  { legacySweeps = false }: { legacySweeps?: boolean } = {}
): Promise<NextResponse> {
  const startedAt = Date.now();
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

  if (legacySweeps) {
    try {
      await checkAndSendAppointmentReminders();
    } catch (reminderErr) {
      console.error(
        '[Automation Cron] Appointment reminders check failed:',
        reminderErr
      );
    }
    try {
      await sweepAndSendBroadcasts();
    } catch (broadcastErr) {
      console.error('[Automation Cron] Broadcast sweep failed:', broadcastErr);
    }
  }

  try {
    const { error } = await supabaseAdmin().rpc('reconcile_subscriptions');
    if (error) throw error;
  } catch (reconcileErr) {
    console.error(
      '[Automation Cron] Billing reconciliation failed:',
      reconcileErr
    );
  }

  try {
    return NextResponse.json(
      await drainPendingExecutions({
        budgetMs: RESUME_TIME_BUDGET_MS - (Date.now() - startedAt),
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
