'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Phone,
  PhoneIncoming,
  Timer,
  Send,
  MousePointerClick,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { MetricCard } from '@/components/dashboard/metric-card';
import { SkeletonCard, Skeleton } from '@/components/dashboard/skeleton';
import { EmptyState } from '@/components/dashboard/empty-state';
import { BarChart } from '@/components/tremor/bar-chart';
import { cn } from '@/lib/utils';

interface CallAnalytics {
  days: number;
  summary: {
    total: number;
    connected: number;
    noAnswer: number;
    busy: number;
    voicemail: number;
    wrongNumber: number;
    callbackRequested: number;
    voiceAgent: number;
    manual: number;
    inbound: number;
    outbound: number;
    avgDurationSeconds: number | null;
    totalDurationSeconds: number;
  };
  series: { day: string; total: number; connected: number }[];
  dispositions: {
    disposition: string;
    calls: number;
    followupsSent: number;
    followupsOpened: number;
  }[];
  funnel: {
    total: number;
    sent: number;
    opened: number;
    completed: number;
    skipped: number;
    failed: number;
    scheduled: number;
  };
  skips: { reason: string; followups: number }[];
}

type RangeDays = 7 | 30 | 90;
const RANGES: RangeDays[] = [7, 30, 90];

const DISPOSITION_LABELS: Record<string, string> = {
  qualified: 'Qualified',
  budget_mismatch_open: 'Budget mismatch — wants options',
  budget_mismatch_closed: 'Budget mismatch — closed',
  requirement_changed: 'Requirement changed',
  not_now: 'Not now',
  already_bought: 'Already bought',
  just_browsing: 'Just browsing',
  wants_site_visit: 'Wants a site visit',
  wants_details: 'Wants details',
  wants_human: 'Wants a person',
  language_barrier: 'Language barrier',
  do_not_call: 'Do not call',
  is_agent_broker: 'Broker, not buyer',
  has_property_to_sell: 'Has a property to sell',
};

const SKIP_LABELS: Record<string, string> = {
  opted_out: 'Lead opted out',
  window_shut: '24-hour window shut',
  opener_template_missing: 'Opener template not created',
  opener_template_marketing: 'Opener template stuck as Marketing',
  contact_unreachable: 'Contact unreachable',
  send_failed: 'Send failed',
};

const OUTCOME_ROWS = [
  ['connected', 'Connected'],
  ['noAnswer', 'No answer'],
  ['busy', 'Busy'],
  ['voicemail', 'Voicemail'],
  ['wrongNumber', 'Wrong number'],
  ['callbackRequested', 'Callback requested'],
] as const;

async function fetchAnalytics(days: RangeDays): Promise<CallAnalytics> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const res = await fetch(
    `/api/calls/analytics?days=${days}&tz=${encodeURIComponent(tz)}`
  );
  const json = (await res.json().catch(() => ({}))) as {
    data?: CallAnalytics;
    error?: string;
  };
  if (!res.ok || !json.data) throw new Error(json.error || 'Request failed');
  return json.data;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function pct(part: number, whole: number): string {
  if (!whole) return '0%';
  return `${Math.round((part / whole) * 100)}%`;
}

const cardChrome =
  'rounded-2xl border border-slate-800/80 bg-slate-900/45 backdrop-blur-sm shadow-md hover:border-primary/20 transition-all duration-300 relative group overflow-hidden';

export default function CallAnalyticsContent() {
  const { accountId } = useAuth();
  const [range, setRange] = useState<RangeDays>(30);

  const query = useQuery({
    queryKey: ['call-analytics', accountId, range],
    queryFn: () => fetchAnalytics(range),
    enabled: Boolean(accountId),
    placeholderData: (prev) => prev,
  });

  const data = query.data ?? null;
  const loading = query.isPending;

  const chartData = (data?.series ?? []).map((point) => ({
    day: new Date(point.day).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
    }),
    Calls: point.total,
    Connected: point.connected,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          How your calls performed, what each one produced, and where the
          follow-ups went.
        </p>
        <div className="flex rounded-lg border border-slate-800 bg-slate-900/60 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                'cursor-pointer rounded-md px-3 py-1.5 text-xs font-semibold transition-all',
                range === r
                  ? 'bg-primary/15 text-white'
                  : 'text-slate-400 hover:text-white'
              )}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading || !data ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title="Calls"
              value={String(data.summary.total)}
              icon={Phone}
              subtitle={`${data.summary.voiceAgent} by voice agent · ${data.summary.manual} manual`}
            />
            <MetricCard
              title="Connect rate"
              value={pct(data.summary.connected, data.summary.total)}
              icon={PhoneIncoming}
              subtitle={`${data.summary.connected} of ${data.summary.total} answered`}
            />
            <MetricCard
              title="Avg call length"
              value={formatDuration(data.summary.avgDurationSeconds)}
              icon={Timer}
              subtitle="Connected calls only"
            />
            <MetricCard
              title="Follow-ups sent"
              value={String(data.funnel.sent)}
              icon={Send}
              subtitle={`${data.funnel.opened} opener taps · ${data.funnel.scheduled} scheduled`}
            />
          </>
        )}
      </div>

      <div className={cardChrome}>
        <header className="flex items-center justify-between gap-3 border-b border-slate-900/60 px-5 py-4">
          <h3 className="text-sm font-bold text-white">Calls per day</h3>
          <span className="text-xs text-slate-500">
            Connected vs total, last {range} days
          </span>
        </header>
        <div className="p-5">
          {loading && !data ? (
            <Skeleton className="h-[260px]" />
          ) : chartData.length === 0 ? (
            <EmptyState
              icon={Phone}
              title="No calls in this period"
              hint="Run a voice campaign or log calls on contacts, and they'll chart here."
            />
          ) : (
            <BarChart
              data={chartData}
              index="day"
              categories={['Calls', 'Connected']}
              colors={['violet', 'emerald']}
              showLegend={true}
              yAxisWidth={40}
              allowDecimals={false}
              className="h-[260px]"
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={cardChrome}>
          <header className="border-b border-slate-900/60 px-5 py-4">
            <h3 className="text-sm font-bold text-white">Call outcomes</h3>
          </header>
          <div className="space-y-3 p-5">
            {loading || !data ? (
              <Skeleton className="h-40" />
            ) : data.summary.total === 0 ? (
              <EmptyState title="No calls yet" />
            ) : (
              OUTCOME_ROWS.map(([key, label]) => {
                const count = data.summary[key];
                const share = data.summary.total
                  ? (count / data.summary.total) * 100
                  : 0;
                return (
                  <div key={key} className="flex items-center gap-3">
                    <span className="w-36 shrink-0 text-xs font-medium text-slate-400">
                      {label}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="bg-primary/70 h-full rounded-full"
                        style={{ width: `${share}%` }}
                      />
                    </div>
                    <span className="w-12 shrink-0 text-right text-xs text-slate-300 tabular-nums">
                      {count}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className={cardChrome}>
          <header className="flex items-center justify-between border-b border-slate-900/60 px-5 py-4">
            <h3 className="text-sm font-bold text-white">Follow-up funnel</h3>
            <MousePointerClick className="h-4 w-4 text-slate-500" />
          </header>
          <div className="p-5">
            {loading || !data ? (
              <Skeleton className="h-40" />
            ) : data.funnel.total === 0 ? (
              <EmptyState
                title="No follow-ups yet"
                hint="Connected calls with a disposition enrol here automatically."
              />
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-4 gap-2 text-center">
                  {(
                    [
                      ['Enrolled', data.funnel.total],
                      ['Sent', data.funnel.sent],
                      ['Opened', data.funnel.opened],
                      ['Completed', data.funnel.completed],
                    ] as const
                  ).map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-xl border border-slate-800 bg-slate-900/60 px-2 py-3"
                    >
                      <p className="text-lg font-black text-white tabular-nums">
                        {value}
                      </p>
                      <p className="mt-0.5 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                        {label}
                      </p>
                    </div>
                  ))}
                </div>
                {data.funnel.skipped > 0 || data.funnel.failed > 0 ? (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-slate-400">
                      {data.funnel.skipped} skipped · {data.funnel.failed}{' '}
                      failed
                    </p>
                    {data.skips.map((skip) => (
                      <p key={skip.reason} className="text-xs text-slate-500">
                        {SKIP_LABELS[skip.reason] || skip.reason} —{' '}
                        <span className="tabular-nums">{skip.followups}</span>
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={cardChrome}>
        <header className="border-b border-slate-900/60 px-5 py-4">
          <h3 className="text-sm font-bold text-white">
            What the calls produced
          </h3>
        </header>
        <div className="p-5">
          {loading || !data ? (
            <Skeleton className="h-40" />
          ) : data.dispositions.length === 0 ? (
            <EmptyState
              title="No dispositions yet"
              hint="When the voice agent reports what each conversation produced, the breakdown lands here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-xs font-bold tracking-wider text-slate-500 uppercase">
                    <th className="pr-4 pb-2">Disposition</th>
                    <th className="pr-4 pb-2 text-right">Calls</th>
                    <th className="pr-4 pb-2 text-right">Follow-ups sent</th>
                    <th className="pb-2 text-right">Opener taps</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dispositions.map((row) => (
                    <tr
                      key={row.disposition}
                      className="border-b border-slate-900/60 last:border-0"
                    >
                      <td className="py-2.5 pr-4 text-slate-300">
                        {DISPOSITION_LABELS[row.disposition] || row.disposition}
                      </td>
                      <td className="py-2.5 pr-4 text-right text-white tabular-nums">
                        {row.calls}
                      </td>
                      <td className="py-2.5 pr-4 text-right text-slate-300 tabular-nums">
                        {row.followupsSent}
                      </td>
                      <td className="py-2.5 text-right text-slate-300 tabular-nums">
                        {row.followupsOpened}
                        {row.followupsSent > 0 && (
                          <span className="ml-1 text-xs text-slate-500">
                            ({pct(row.followupsOpened, row.followupsSent)})
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
