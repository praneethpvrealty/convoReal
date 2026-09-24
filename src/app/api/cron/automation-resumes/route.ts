import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  drainPendingExecutions,
  RESUME_TIME_BUDGET_MS,
} from '@/lib/automations/resume-pending';

export const maxDuration = 300;

/**
 * Drain due `automation_pending_executions` rows and run billing
 * reconciliation. Appointment reminders and the broadcast sweep run on
 * their own crons (/api/appointments/cron, /api/cron/broadcast-sweep).
 *
 * Registered in vercel.json (every 5 minutes) under /api/cron/, which
 * the Cloudflare pre-launch rule exempts for Vercel Cron's US traffic
 * (docs/cloudflare-waf.md); /api/automations/cron re-exports it. Auth: same constant-time
 * shared-secret check as the other crons — `x-cron-secret` header OR
 * Vercel Cron's `Authorization: Bearer`, matched against
 * AUTOMATION_CRON_SECRET or CRON_SECRET. Fails CLOSED (503) when no
 * secret is configured.
 */
export async function GET(request: Request) {
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
