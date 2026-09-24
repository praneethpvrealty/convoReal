import { handleAutomationCron } from '@/lib/automations/cron-handler';

export const maxDuration = 300;

/**
 * Drain due `automation_pending_executions` rows and run billing
 * reconciliation. Appointment reminders and the broadcast sweep run on
 * their own crons (/api/appointments/cron, /api/cron/broadcast-sweep).
 *
 * Registered in vercel.json (every 5 minutes) under /api/cron/, which
 * the Cloudflare pre-launch rule exempts for Vercel Cron's US traffic
 * (docs/cloudflare-waf.md). /api/automations/cron, the path self-hosted
 * pingers call, runs the same handler plus the reminder and broadcast
 * sweeps it always ran. Auth: same constant-time
 * shared-secret check as the other crons — `x-cron-secret` header OR
 * Vercel Cron's `Authorization: Bearer`, matched against
 * AUTOMATION_CRON_SECRET or CRON_SECRET. Fails CLOSED (503) when no
 * secret is configured.
 */
export function GET(request: Request) {
  return handleAutomationCron(request);
}
