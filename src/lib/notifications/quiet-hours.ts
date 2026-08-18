import { supabaseAdmin } from '@/lib/automations/admin-client';

export type QuietAudience = 'client' | 'agent';

export interface QuietPeriod {
  enabled: boolean;
  start: string;
  end: string;
}

export interface QuietPeriodStatus {
  isQuiet: boolean;
  deliverAt: Date | null;
}

export const DEFAULT_QUIET_PERIODS: Record<QuietAudience, QuietPeriod> = {
  client: { enabled: true, start: '21:00', end: '08:00' },
  agent: { enabled: true, start: '22:00', end: '07:00' },
};

const IST_OFFSET_MINUTES = 330;

function minutesOfDay(value: string): number {
  const [hour = '0', minute = '0'] = value.split(':');
  return Number(hour) * 60 + Number(minute);
}

export function quietPeriodStatus(
  now: Date,
  period: QuietPeriod
): QuietPeriodStatus {
  if (!period.enabled) return { isQuiet: false, deliverAt: null };

  const start = minutesOfDay(period.start);
  const end = minutesOfDay(period.end);
  if (start === end) return { isQuiet: false, deliverAt: null };

  const local = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  const current = local.getUTCHours() * 60 + local.getUTCMinutes();
  const overnight = start > end;
  const isQuiet = overnight
    ? current >= start || current < end
    : current >= start && current < end;
  if (!isQuiet) return { isQuiet: false, deliverAt: null };

  const endHour = Math.floor(end / 60);
  const endMinute = end % 60;
  const addDay = overnight && current >= start ? 1 : 0;
  const deliverAt = new Date(
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() + addDay,
      endHour,
      endMinute
    ) -
      IST_OFFSET_MINUTES * 60_000
  );

  return { isQuiet: true, deliverAt };
}

export async function resolveQuietPeriod(
  accountId: string,
  audience: QuietAudience,
  now: Date = new Date()
): Promise<QuietPeriodStatus> {
  const defaults = DEFAULT_QUIET_PERIODS[audience];

  try {
    const { data, error } = await supabaseAdmin()
      .from('accounts')
      .select(
        'client_quiet_hours_enabled, client_quiet_hours_start, client_quiet_hours_end, agent_quiet_hours_enabled, agent_quiet_hours_start, agent_quiet_hours_end'
      )
      .eq('id', accountId)
      .maybeSingle();
    if (error) throw error;

    const period =
      audience === 'client'
        ? {
            enabled: data?.client_quiet_hours_enabled ?? defaults.enabled,
            start: data?.client_quiet_hours_start ?? defaults.start,
            end: data?.client_quiet_hours_end ?? defaults.end,
          }
        : {
            enabled: data?.agent_quiet_hours_enabled ?? defaults.enabled,
            start: data?.agent_quiet_hours_start ?? defaults.start,
            end: data?.agent_quiet_hours_end ?? defaults.end,
          };
    return quietPeriodStatus(now, period);
  } catch (error) {
    console.error(
      '[quiet-hours] settings lookup failed, using defaults:',
      error
    );
    return quietPeriodStatus(now, defaults);
  }
}
