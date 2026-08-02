'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  CheckCircle2,
  FileText,
  MailOpen,
  MessageCircleReply,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  combinedReadRate,
  loadTemplateAnalytics,
  rate,
  summarizeTemplates,
  totalSends,
  type TemplateAnalyticsRow,
} from '@/lib/whatsapp/template-analytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { cn } from '@/lib/utils';

type Range = 30 | 90 | 365;

const RANGE_LABELS: Record<Range, string> = {
  30: '30d',
  90: '90d',
  365: '1y',
};

const STATUS_BADGES: Record<string, string> = {
  Approved: 'bg-emerald-500/10 text-emerald-400',
  Pending: 'bg-amber-500/10 text-amber-400',
  Rejected: 'bg-red-500/10 text-red-400',
  Draft: 'bg-slate-500/10 text-slate-400',
};

const QUALITY_BADGES: Record<string, string> = {
  GREEN: 'bg-emerald-500/10 text-emerald-400',
  YELLOW: 'bg-amber-500/10 text-amber-400',
  RED: 'bg-red-500/10 text-red-400',
};

function pct(value: number | null): string {
  return value == null ? '—' : `${value.toFixed(0)}%`;
}

function readRateChip(row: TemplateAnalyticsRow) {
  const value = combinedReadRate(row);
  if (value == null) return <span className="text-slate-600">—</span>;
  return (
    <span
      className={cn(
        'rounded-md px-1.5 py-0.5 text-xs font-medium',
        value >= 60
          ? 'bg-emerald-500/10 text-emerald-400'
          : value >= 30
            ? 'bg-amber-500/10 text-amber-400'
            : 'bg-red-500/10 text-red-400'
      )}
    >
      {value.toFixed(0)}%
    </span>
  );
}

export default function TemplatePerformanceContent() {
  const db = createClient();
  const { accountId } = useAuth();
  const [range, setRange] = useState<Range>(90);

  const templatesQuery = useQuery({
    queryKey: ['template-analytics', accountId, range],
    queryFn: () => loadTemplateAnalytics(db, accountId!, range),
    enabled: !!accountId,
  });

  if (templatesQuery.isLoading) {
    return (
      <p className="py-16 text-center text-sm text-slate-500">
        Loading template performance...
      </p>
    );
  }

  if (templatesQuery.isError) {
    return (
      <p className="py-16 text-center text-sm text-red-400">
        Failed to load template performance. Ensure the template_analytics
        database function is deployed (migration 183).
      </p>
    );
  }

  const rows = templatesQuery.data ?? [];
  const totals = summarizeTemplates(rows);

  const tiles = [
    {
      title: 'Templates',
      value: totals.templates.toLocaleString(),
      sub: `${totals.approved.toLocaleString()} approved`,
      icon: FileText,
    },
    {
      title: 'Template Sends',
      value: totals.totalSends.toLocaleString(),
      sub: `${totals.broadcastSent.toLocaleString()} via broadcasts`,
      icon: CheckCircle2,
    },
    {
      title: 'Read Rate',
      value: pct(totals.readRate),
      sub: 'Across broadcasts and 1:1 sends',
      icon: MailOpen,
    },
    {
      title: 'Reply Rate',
      value: pct(totals.replyRate),
      sub: `${totals.broadcastReplied.toLocaleString()} broadcast replies`,
      icon: MessageCircleReply,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-400">
          How each approved template performs across broadcasts and direct
          sends.
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
              <div className="text-2xl font-black text-white">{tile.value}</div>
              <p className="mt-1 text-xs text-slate-500">{tile.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
        <div className="border-b border-slate-800 p-4">
          <h3 className="flex items-center text-sm font-bold text-white">
            Template Leaderboard
            <InfoHint text="Broadcast counts come from campaign delivery receipts; direct sends are 1:1 template messages outside broadcasts. Read rate combines both channels." />
          </h3>
        </div>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            No templates yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs text-slate-500 uppercase">
                  <th className="px-4 py-3">Template</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Quality</th>
                  <th className="px-4 py-3 text-right">Campaigns</th>
                  <th className="px-4 py-3 text-right">Broadcast Sent</th>
                  <th className="px-4 py-3 text-right">Delivered</th>
                  <th className="px-4 py-3 text-right">Replied</th>
                  <th className="px-4 py-3 text-right">Direct Sends</th>
                  <th className="px-4 py-3 text-right">Read Rate</th>
                  <th className="px-4 py-3 text-right">Last Used</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.template_id}
                    className="border-b border-slate-800/60 last:border-0"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-200">
                        {row.name}
                      </div>
                      <div className="text-xs text-slate-500">
                        {row.category}
                        {row.language ? ` · ${row.language}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'rounded-md px-1.5 py-0.5 text-xs font-medium',
                          STATUS_BADGES[row.status] ??
                            'bg-slate-500/10 text-slate-400'
                        )}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {row.quality_score ? (
                        <span
                          className={cn(
                            'rounded-md px-1.5 py-0.5 text-xs font-medium',
                            QUALITY_BADGES[row.quality_score]
                          )}
                        >
                          {row.quality_score}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {row.broadcast_campaigns.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {row.broadcast_sent.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {pct(rate(row.broadcast_delivered, row.broadcast_sent))}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {row.broadcast_replied.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {row.direct_sends.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {readRateChip(row)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-slate-400">
                      {row.last_used_at
                        ? format(new Date(row.last_used_at), 'd MMM yy')
                        : '—'}
                    </td>
                  </tr>
                ))}
                {rows.some((r) => totalSends(r) === 0) && (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-4 py-2 text-xs text-slate-600"
                    >
                      Templates with no sends in the selected period appear with
                      zero counts.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
