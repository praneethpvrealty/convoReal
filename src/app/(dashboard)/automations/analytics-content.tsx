'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  CheckCircle2,
  GitBranch,
  History,
  Pencil,
  Workflow,
  XCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useCan } from '@/hooks/useCan';
import {
  buildFunnelSteps,
  completionRate,
  formatDurationSeconds,
  loadAutomationAnalytics,
  loadFlowAnalytics,
  loadFlowNodeFunnel,
  type AutomationAnalyticsRow,
} from '@/lib/automations/analytics';
import { triggerMeta } from '@/lib/automations/trigger-meta';
import { graphWalkOrder, orderFunnelRows } from '@/lib/flows/funnel-order';
import type { FlowNodeRow, FlowRow } from '@/lib/flows/types';
import {
  NODE_META,
  summarizeNode,
  type BuilderNode,
  type NodeType,
} from '@/components/flows/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { TabSkeleton } from '@/components/dashboard/skeleton';
import { cn } from '@/lib/utils';

type Range = 7 | 30 | 90;

const RANGES: Range[] = [7, 30, 90];

interface FlowGraph {
  flow: Pick<FlowRow, 'entry_node_id'>;
  nodes: FlowNodeRow[];
}

async function fetchFlowGraph(flowId: string): Promise<FlowGraph> {
  const res = await fetch(`/api/flows/${flowId}`);
  if (!res.ok) throw new Error('Failed to load flow');
  return (await res.json()) as FlowGraph;
}

function settledRate(
  row: Pick<AutomationAnalyticsRow, 'runs' | 'succeeded' | 'partial'>
): number | null {
  const settled = row.runs - row.partial;
  if (settled <= 0) return null;
  return (row.succeeded / settled) * 100;
}

function rateChip(rate: number | null, goodAt = 90, okAt = 60) {
  if (rate == null) return <span className="text-slate-400">—</span>;
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
  const canEdit = useCan('make-changes');
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

  const graphQuery = useQuery({
    queryKey: ['flow-graph', activeFlowId],
    queryFn: () => fetchFlowGraph(activeFlowId!),
    enabled: !!activeFlowId,
  });

  const graphNodes = useMemo<BuilderNode[]>(
    () =>
      (graphQuery.data?.nodes ?? []).map((n) => ({
        node_key: n.node_key,
        node_type: n.node_type as NodeType,
        config: n.config as Record<string, unknown>,
      })),
    [graphQuery.data]
  );

  if (automationsQuery.isLoading || flowsQuery.isLoading) {
    return <TabSkeleton label="Loading analytics" tiles={4} cards={2} />;
  }

  if (automationsQuery.isError || flowsQuery.isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-red-400">Couldn&apos;t load analytics.</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (automationsQuery.isError) automationsQuery.refetch();
            if (flowsQuery.isError) flowsQuery.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  const automations = automationsQuery.data ?? [];
  const automationRuns = automations.reduce((sum, a) => sum + a.runs, 0);
  const automationSucceeded = automations.reduce(
    (sum, a) => sum + a.succeeded,
    0
  );
  const automationFailed = automations.reduce((sum, a) => sum + a.failed, 0);
  const automationWaiting = automations.reduce((sum, a) => sum + a.partial, 0);
  const automationSettled = automationRuns - automationWaiting;
  const flowRuns = flows.reduce((sum, f) => sum + f.runs, 0);
  const flowCompleted = flows.reduce((sum, f) => sum + f.completed, 0);

  const activeFlow = flows.find((f) => f.flow_id === activeFlowId) ?? null;
  const funnelSteps = buildFunnelSteps(
    orderFunnelRows(
      funnelQuery.data ?? [],
      graphWalkOrder(graphNodes, graphQuery.data?.flow.entry_node_id ?? null)
    )
  );
  const nodeByKey = new Map(graphNodes.map((n) => [n.node_key, n]));

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
        automationSettled > 0
          ? `${((automationSucceeded / automationSettled) * 100).toFixed(0)}%`
          : '—',
      sub: `${automationFailed.toLocaleString()} failed · ${automationWaiting.toLocaleString()} waiting`,
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
              aria-pressed={range === r}
              onClick={() => setRange(r)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                range === r
                  ? 'bg-primary/20 text-primary'
                  : 'text-slate-400 hover:text-slate-200'
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
                  <th className="px-4 py-3 text-right">Waiting</th>
                  <th className="px-4 py-3 text-right">Failed</th>
                  <th className="px-4 py-3 text-right">Last Run</th>
                  <th className="px-4 py-3 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
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
                      {triggerMeta(row.trigger_type).label}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">
                      {row.runs.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {rateChip(settledRate(row))}
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
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {canEdit && (
                          <Link
                            href={`/automations/${row.automation_id}/edit`}
                            aria-label={`Edit ${row.name}`}
                            className={buttonVariants({
                              variant: 'ghost',
                              size: 'sm',
                            })}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </Link>
                        )}
                        <Link
                          href={`/automations/${row.automation_id}/logs`}
                          aria-label={`Logs for ${row.name}`}
                          className={buttonVariants({
                            variant: 'ghost',
                            size: 'sm',
                          })}
                        >
                          <History className="h-3.5 w-3.5" />
                          Logs
                        </Link>
                      </div>
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
                  <th className="px-4 py-3 text-right">
                    <span className="sr-only">Funnel</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {flows.map((row) => (
                  <tr
                    key={row.flow_id}
                    className={cn(
                      'border-b border-slate-800/60 transition-colors last:border-0',
                      activeFlowId === row.flow_id && 'bg-primary/5'
                    )}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/flows/${row.flow_id}/runs`}
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
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-pressed={activeFlowId === row.flow_id}
                        onClick={() => setSelectedFlowId(row.flow_id)}
                      >
                        View funnel
                      </Button>
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
          {funnelQuery.isLoading || graphQuery.isLoading ? (
            <p className="py-6 text-center text-sm text-slate-500">
              Loading funnel...
            </p>
          ) : funnelSteps.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              No node activity for this flow in the selected period.
            </p>
          ) : (
            <div className="space-y-2">
              {funnelSteps.map((step) => {
                const node = nodeByKey.get(step.node_key);
                const typeLabel = step.node_type
                  ? (NODE_META[step.node_type as NodeType]?.label ??
                    step.node_type.replace(/_/g, ' '))
                  : null;
                const label =
                  (node && summarizeNode(node)) ?? typeLabel ?? step.node_key;
                return (
                  <div key={step.node_key} className="flex items-center gap-3">
                    <div className="w-40 shrink-0 text-right">
                      <span
                        className="block truncate text-sm font-medium text-slate-300"
                        title={label}
                      >
                        {label}
                      </span>
                      {typeLabel && label !== typeLabel && (
                        <span className="block truncate text-xs text-slate-400">
                          {typeLabel}
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
                        <span className="text-xs text-slate-400">
                          {step.pctOfStarted.toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
