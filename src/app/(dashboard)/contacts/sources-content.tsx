'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Handshake, Trophy, UserPlus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrencyShort } from '@/lib/currency-utils';
import {
  conversionRate,
  loadEmailSyncHealth,
  loadLeadSourceAnalytics,
  summarizeLeadSources,
} from '@/lib/contacts/source-analytics';
import { BarChart } from '@/components/tremor/bar-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { cn } from '@/lib/utils';

type Range = 30 | 90 | 365;

const RANGE_LABELS: Record<Range, string> = {
  30: '30d',
  90: '90d',
  365: '1y',
};

const HEALTH_LABELS: Record<string, { label: string; className: string }> = {
  success: { label: 'Leads captured', className: 'text-emerald-400' },
  failed: { label: 'Failed to parse', className: 'text-red-400' },
  ignored: { label: 'Ignored emails', className: 'text-slate-400' },
};

export default function SourcesContent() {
  const db = createClient();
  const { accountId } = useAuth();
  const [range, setRange] = useState<Range>(90);

  const sourcesQuery = useQuery({
    queryKey: ['lead-sources', accountId, range],
    queryFn: () => loadLeadSourceAnalytics(db, accountId!, range),
    enabled: !!accountId,
  });

  const healthQuery = useQuery({
    queryKey: ['email-sync-health', accountId, range],
    queryFn: () => loadEmailSyncHealth(db, accountId!, range),
    enabled: !!accountId,
  });

  if (sourcesQuery.isLoading) {
    return (
      <p className="py-16 text-center text-sm text-slate-500">
        Loading lead sources...
      </p>
    );
  }

  if (sourcesQuery.isError) {
    return (
      <p className="py-16 text-center text-sm text-red-400">
        Failed to load lead sources. Ensure the lead_source_analytics database
        function is deployed (migration 184).
      </p>
    );
  }

  const rows = sourcesQuery.data ?? [];
  const summary = summarizeLeadSources(rows);
  const health = healthQuery.data ?? [];
  const healthTotal = health.reduce((sum, h) => sum + h.events, 0);
  const failed = health.find((h) => h.status === 'failed');

  const chartData = rows
    .filter((r) => r.contacts_added > 0)
    .slice(0, 10)
    .map((r) => ({ source: r.source, Contacts: r.contacts_added }));

  const tiles = [
    {
      title: 'New Contacts',
      value: summary.contactsAdded.toLocaleString(),
      sub: `from ${summary.sources} source${summary.sources === 1 ? '' : 's'}`,
      icon: UserPlus,
    },
    {
      title: 'Top Source',
      value: summary.topSource?.source ?? '—',
      sub: summary.topSource
        ? `${summary.topSource.contacts_added.toLocaleString()} contacts`
        : 'No contacts in this period',
      icon: Trophy,
    },
    {
      title: 'Deals From Leads',
      value: summary.dealsCreated.toLocaleString(),
      sub: `${summary.dealsWon.toLocaleString()} won`,
      icon: Handshake,
    },
    {
      title: 'Won Value',
      value: formatCurrencyShort(summary.wonValue),
      sub: 'Brokerage from won deals',
      icon: Trophy,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-400">
          Where your leads come from, and which sources turn into deals.
        </p>
        <div className="flex gap-1">
          {(Object.keys(RANGE_LABELS) as unknown as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(Number(r) as Range)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                range === Number(r)
                  ? 'bg-primary/20 text-primary'
                  : 'text-slate-500 hover:text-slate-300'
              )}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Card
            key={tile.title}
            className="border-slate-700 bg-slate-900 ring-0 ring-transparent"
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-semibold text-slate-400">
                {tile.title}
              </CardTitle>
              <tile.icon className="text-primary h-4 w-4" />
            </CardHeader>
            <CardContent>
              <div className="truncate text-2xl font-black text-white">
                {tile.value}
              </div>
              <p className="mt-1 text-xs text-slate-500">{tile.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 lg:col-span-2">
          <h3 className="mb-3 text-sm font-bold text-white">
            New Contacts by Source
          </h3>
          {chartData.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No new contacts in this period.
            </p>
          ) : (
            <BarChart
              data={chartData}
              index="source"
              categories={['Contacts']}
              colors={['violet']}
              valueFormatter={(value) => value.toLocaleString()}
              showLegend={false}
              layout="vertical"
              yAxisWidth={110}
              className="h-[260px]"
            />
          )}
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h3 className="flex items-center text-sm font-bold text-white">
            Email Lead Sync
            <InfoHint text="Inbound portal emails (MagicBricks, Housing, 99acres) processed by the email lead webhook in this period." />
          </h3>
          {healthTotal === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No portal emails in this period.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {(['success', 'failed', 'ignored'] as const).map((status) => {
                const entry = health.find((h) => h.status === status);
                const meta = HEALTH_LABELS[status];
                return (
                  <div
                    key={status}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-slate-400">{meta.label}</span>
                    <span className="text-right">
                      <span className={cn('font-semibold', meta.className)}>
                        {(entry?.events ?? 0).toLocaleString()}
                      </span>
                      {entry?.last_at && (
                        <span className="block text-xs text-slate-600">
                          last {format(new Date(entry.last_at), 'd MMM, HH:mm')}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
              {failed && failed.events > 0 && (
                <p className="rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-400">
                  Some portal emails could not be parsed into leads — check the
                  email sync settings.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
        <div className="border-b border-slate-800 p-4">
          <h3 className="flex items-center text-sm font-bold text-white">
            Source Attribution
            <InfoHint text="Deals are attributed to the source of their contact. Conversion is deals created per new contact in the period." />
          </h3>
        </div>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            No sourced activity in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs text-slate-500 uppercase">
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3 text-right">New Contacts</th>
                  <th className="px-4 py-3 text-right">Deals Created</th>
                  <th className="px-4 py-3 text-right">Deals Won</th>
                  <th className="px-4 py-3 text-right">Won Value</th>
                  <th className="px-4 py-3 text-right">Conversion</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const conv = conversionRate(row);
                  return (
                    <tr
                      key={row.source}
                      className="border-b border-slate-800/60 last:border-0"
                    >
                      <td className="px-4 py-3 font-medium text-slate-200">
                        {row.source}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">
                        {row.contacts_added.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">
                        {row.deals_created.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">
                        {row.deals_won.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">
                        {row.deals_won > 0
                          ? formatCurrencyShort(Number(row.won_value))
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {conv == null ? (
                          <span className="text-slate-600">—</span>
                        ) : (
                          <span
                            className={cn(
                              'rounded-md px-1.5 py-0.5 text-xs font-medium',
                              conv >= 20
                                ? 'bg-emerald-500/10 text-emerald-400'
                                : conv >= 5
                                  ? 'bg-amber-500/10 text-amber-400'
                                  : 'bg-slate-500/10 text-slate-400'
                            )}
                          >
                            {conv.toFixed(1)}%
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
