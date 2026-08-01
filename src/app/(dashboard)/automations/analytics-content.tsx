'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { CheckCircle2, GitBranch, Workflow, XCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  buildFunnelSteps,
  completionRate,
  formatDurationSeconds,
  loadAutomationAnalytics,
  loadFlowAnalytics,
  loadFlowNodeFunnel,
  successRate,
} from '@/lib/automations/analytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Range = 7 | 30 | 90;

const RANGES: Range[] = [7, 30, 90];

function rateChip(rate: number | null, goodAt = 90, okAt = 60) {
  if (rate == null) return <span className="text-slate-600">—</span>;
  return (
    <span
      className={cn(
        'rounded-md px-1.5 py-0.5 text-xs font-medium',
        rate >= goodAt
          ? 'bg-emerald-500/10 text-emerald-400'
          : rate >= okAt
            ? 'bg-amber-500/10 text-amber-400'
            : 'bg-red-500/10 text-red-400'
      )}
    >
      {rate.toFixed(0)}%
    </span>
  );
}

export default function AutomationAnalyticsContent() {
  const db = createClient();
  const { accountId } = useAuth();
  const [range, setRange] = useState<Range>(30);
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);

  const automationsQuery = useQuery({
    queryKey: ['automation-analytics', accountId, range],
    queryFn: () => loadAutomationAnalytics(db, accountId!, range),
    enabled: !!accountId,
  });

  const flowsQuery = useQuery({
    queryKey: ['flow-analytics', accountId, range],
    queryFn: () => loadFlowAnalytics(db, accountId!, range),
    enabled: !!accountId,
  });

  const flows = useMemo(() => flowsQuery.data ?? [], [flowsQuery.data]);
  const activeFlowId =
    selectedFlowId ?? flows.find((f) => f.runs > 0)?.flow_id ?? null;

  const funnelQuery = useQuery({
    queryKey: ['flow-node-funnel', accountId, activeFlowId, range],
    queryFn: () => loadFlowNodeFunnel(db, accountId!, activeFlowId!, range),
    enabled: !!accountId && !!activeFlowId,
  });

  if (automationsQuery.isLoading || flowsQuery.isLoading) {
    return (
      <p className="py-16 text-center text-sm text-slate-500">
        Loading analytics...
      </p>
    );
  }

  if (automationsQuery.isError || flowsQuery.isError) {
    return (
      <p className="py-16 text-center text-sm text-red-400">
        Failed to load analytics. Ensure the automation and flow analytics
        database functions are deployed (migration 182).
      </p>
    );
  }

  const automations = automationsQuery.data ?? [];
  const automationRuns = automations.reduce((sum, a) => sum + a.runs, 0);
  const automationSucceeded = automations.reduce(
    (sum, a) => sum + a.succeeded,
    0
  );
  const automationFailed = automations.reduce((sum, a) => sum + a.failed, 0);
  const flowRuns = flows.reduce((sum, f) => sum + f.runs, 0);
  const flowCompleted = flows.reduce((sum, f) => sum + f.completed, 0);

  const activeFlow = flows.find((f) => f.flow_id === activeFlowId) ?? null;
  const funnelSteps = buildFunnelSteps(funnelQuery.data ?? []);

  const tiles = [
    {
      title: 'Automation Runs',
      value: automationRuns.toLocaleString(),
      sub: `across ${automations.length} automation${automations.length === 1 ? '' : 's'}`,
      icon: GitBranch,
    },
    {
      title: 'Automation Success',
      value:
        automationRuns > 0
          ? `${((automationSucceeded / automationRuns) * 100).toFixed(0)}%`
          : '—',
      sub: `${automationFailed.toLocaleString()} failed`,
      icon: CheckCircle2,
    },
    {
      title: 'Flow Runs',
      value: flowRuns.toLocaleString(),
      sub: `across ${flows.length} flow${flows.length === 1 ? '' : 's'}`,
      icon: Workflow,
    },
    {
      title: 'Flow Completion',
      value:
        flowRuns > 0
          ? `${((flowCompleted / flowRuns) * 100).toFixed(0)}%`
          : '—',
      sub: `${flows.reduce((sum, f) => sum + f.handed_off, 0).toLocaleString()} handed off`,
      icon: XCircle,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-400">
          Execution outcomes for your automations and interactive flows.
        </p>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                range === r
                  ? 'bg-primary/20 text-primary'
                  : 'text-slate-500 hover:text-slate-300'
              )}
            >
              {r}d
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
          <h3 className="text-sm font-bold text-white">Automations</h3>
        </div>
        {automations.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            No automations yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs text-slate-500 uppercase">
                  <th className="px-4 py-3">Automation</th>
                  <th className="px-4 py-3">Trigger</th>
                  <th className="px-4 py-3 text-right">Runs</th>
                  <th className="px-4 py-3 text-right">Success</th>
                  <th className="px-4 py-3 text-right">Partial</th>
                  <th className="px-4 py-3 text-right">Failed</th>
                  <th className="px-4 py-3 text-right">Last Run</th>
                </tr>
              </thead>
              <tbody>
                {automations.map((row) => (
                  <tr
                    key={row.automation_id}
                    className="border-b border-slate-800/60 last:border-0"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/automations/${row.automation_id}/logs`}
                        className="font-medium text-slate-200 hover:text-white hover:underline"
                      >
                        {row.name}
                      </Link>
                      {!row.is_active && (
                        <span className="ml-2 rounded-md bg-slate-500/10 px-1.5 py-0.5 text-xs text-slate-500">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {row.trigger_type.replace(/_/g, ' ')}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {row.runs.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {rateChip(successRate(row))}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {row.partial.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {row.failed.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-slate-400">
                      {row.last_run_at
                        ? format(new Date(row.last_run_at), 'd MMM, HH:mm')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
        <div className="border-b border-slate-800 p-4">
          <h3 className="text-sm font-bold text-white">Flows</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Select a flow to see where customers drop off, node by node.
          </p>
        </div>
        {flows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            No flows yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs text-slate-500 uppercase">
                  <th className="px-4 py-3">Flow</th>
                  <th className="px-4 py-3 text-right">Runs</th>
                  <th className="px-4 py-3 text-right">Completed</th>
                  <th className="px-4 py-3 text-right">Handed Off</th>
                  <th className="px-4 py-3 text-right">Timed Out</th>
                  <th className="px-4 py-3 text-right">Failed</th>
                  <th className="px-4 py-3 text-right">Completion</th>
                  <th className="px-4 py-3 text-right">Median Duration</th>
                  <th className="px-4 py-3 text-right">Avg Reprompts</th>
                </tr>
              </thead>
              <tbody>
                {flows.map((row) => (
                  <tr
                    key={row.flow_id}
                    onClick={() => setSelectedFlowId(row.flow_id)}
                    className={cn(
                      'cursor-pointer border-b border-slate-800/60 transition-colors last:border-0 hover:bg-slate-800/40',
                      activeFlowId === row.flow_id && 'bg-primary/5'
                    )}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/flows/${row.flow_id}/runs`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-slate-200 hover:text-white hover:underline"
                      >
                        {row.name}
                      </Link>
                      {row.status !== 'active' && (
                        <span className="ml-2 rounded-md bg-slate-500/10 px-1.5 py-0.5 text-xs text-slate-500">
                          {row.status}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {row.runs.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {row.completed.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {row.handed_off.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {row.timed_out.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {row.failed.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {rateChip(completionRate(row), 70, 40)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {formatDurationSeconds(
                        row.median_duration_seconds == null
                          ? null
                          : Number(row.median_duration_seconds)
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {row.avg_reprompts == null
                        ? '—'
                        : Number(row.avg_reprompts).toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {activeFlow && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h3 className="text-sm font-bold text-white">
            Node Funnel — {activeFlow.name}
          </h3>
          <p className="mt-0.5 mb-4 text-xs text-slate-500">
            Distinct runs that reached each node. The red badge is the drop-off
            from the step above.
          </p>
          {funnelQuery.isLoading ? (
            <p className="py-6 text-center text-sm text-slate-500">
              Loading funnel...
            </p>
          ) : funnelSteps.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              No node activity for this flow in the selected period.
            </p>
          ) : (
            <div className="space-y-2">
              {funnelSteps.map((step) => (
                <div key={step.node_key} className="flex items-center gap-3">
                  <div className="w-40 shrink-0 truncate text-right">
                    <span className="text-sm font-medium text-slate-300">
                      {step.node_key}
                    </span>
                    {step.node_type && (
                      <span className="block text-xs text-slate-600">
                        {step.node_type.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                  <div className="h-7 flex-1 rounded-md bg-slate-800/60">
                    <div
                      className="flex h-7 items-center rounded-md bg-violet-500/70 px-2"
                      style={{ width: `${Math.max(step.pctOfStarted, 4)}%` }}
                    >
                      <span className="text-xs font-semibold text-white">
                        {step.runs_entered.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div className="w-24 shrink-0 text-right">
                    {step.dropOffPct != null && step.dropOffPct > 0 ? (
                      <span className="rounded-md bg-red-500/10 px-1.5 py-0.5 text-xs font-medium text-red-400">
                        −{step.dropOffPct.toFixed(0)}%
                      </span>
                    ) : (
                      <span className="text-xs text-slate-600">
                        {step.pctOfStarted.toFixed(0)}%
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
