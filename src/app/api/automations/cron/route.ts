import { handleAutomationCron } from '@/lib/automations/cron-handler';

export const maxDuration = 300;

export function GET(request: Request) {
  return handleAutomationCron(request, { legacySweeps: true });
}
