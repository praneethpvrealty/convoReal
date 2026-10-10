'use client';

import { useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow, isValid, parseISO } from 'date-fns';
import { ArrowRight, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { netOfPayouts } from '@/lib/deals/co-broking';
import {
  DEAL_EVENT_LABELS,
  timelineActorLabel,
  timelineSourceLabel,
  type DealEvent,
} from '@/lib/deals/events';
import {
  applyMilestonePatch,
  milestoneProgress,
  withMilestoneRow,
  type DealMilestone,
} from '@/lib/deals/milestones';
import {
  STAKEHOLDER_ROLE_LABELS,
  STAKEHOLDER_SIDE_LABELS,
  STAKEHOLDER_SIDES,
  type DealStakeholder,
} from '@/lib/deals/stakeholders';
import type { TrancheSummary } from '@/lib/deals/tranches';
import { brokerageAmount } from '@/lib/pipelines/brokerage';
import { formatDealAmount } from '@/lib/pipelines/deal-money';
import { cn } from '@/lib/utils';

import type { FinancialsResponse } from './deal-financials-panel';
import type { TabId } from './deal-workspace';

interface DealOverviewPanelProps {
  dealId: string;
  deal: {
    value: number | null;
    currency: string | null;
    brokerage_type: 'percentage' | 'fixed' | null;
    brokerage_value: number | null;
    brokerage_amount: number | null;
    co_broker_payout_total: number | null;
  };
  canEdit: boolean;
  onOpenTab: (tab: TabId) => void;
}

interface OverviewTask {
  id: string;
  title: string;
  due_date: string | null;
  completed: boolean;
}

const TASK_PREVIEW_LIMIT = 3;

async function load<T>(path: string, failure: string): Promise<T> {
  const response = await fetch(path);
  const json = await response.json();
  if (!response.ok) throw new Error(json?.error || failure);
  return json;
}

async function call(path: string, init: RequestInit, failure: string) {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error || failure);
  return json;
}

function shortDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = parseISO(value);
  return isValid(parsed) ? format(parsed, 'd MMM yyyy') : value;
}

export function DealOverviewPanel({
  dealId,
  deal,
  canEdit,
  onOpenTab,
}: DealOverviewPanelProps) {
  const queryClient = useQueryClient();
  const { busy, lock, release } = useBusyIds();
  const currency = deal.currency ?? 'INR';

  const milestones = useQuery({
    queryKey: ['deal-milestones', dealId],
    queryFn: async (): Promise<DealMilestone[]> => {
      const json = await load<{ data?: DealMilestone[] }>(
        `/api/deals/${dealId}/milestones`,
        'Could not load milestones'
      );
      return json.data ?? [];
    },
  });

  const tasks = useQuery({
    queryKey: ['deal-tasks', dealId],
    queryFn: async (): Promise<OverviewTask[]> => {
      const json = await load<unknown>(
        `/api/todos?deal_id=${encodeURIComponent(dealId)}`,
        'Could not load tasks'
      );
      return Array.isArray(json) ? (json as OverviewTask[]) : [];
    },
  });

  const events = useQuery({
    queryKey: ['deal-events', dealId],
    queryFn: async (): Promise<DealEvent[]> => {
      const json = await load<{ data?: DealEvent[] }>(
        `/api/deals/${dealId}/events`,
        'Could not load the timeline'
      );
      return json.data ?? [];
    },
  });

  const stakeholders = useQuery({
    queryKey: ['deal-stakeholders', dealId],
    queryFn: async (): Promise<DealStakeholder[]> => {
      const json = await load<{ data?: DealStakeholder[] }>(
        `/api/deals/${dealId}/stakeholders`,
        'Could not load stakeholders'
      );
      return json.data ?? [];
    },
  });

  const financials = useQuery({
    queryKey: ['deal-financials', dealId],
    queryFn: async (): Promise<FinancialsResponse> => {
      const json = await load<{ data: FinancialsResponse }>(
        `/api/deals/${dealId}/financials`,
        'Could not load financials'
      );
      return json.data;
    },
  });

  const tranches = useQuery({
    queryKey: ['deal-tranches', dealId],
    queryFn: async (): Promise<{ summary: TrancheSummary }> => {
      const json = await load<{ data: { summary: TrancheSummary } }>(
        `/api/deals/${dealId}/tranches`,
        'Could not load the payment schedule'
      );
      return json.data;
    },
  });

  async function completeMilestone(m: DealMilestone) {
    const key = ['deal-milestones', dealId];
    lock(m.id);
    await queryClient.cancelQueries({ queryKey: key });
    const previousRow = queryClient
      .getQueryData<DealMilestone[]>(key)
      ?.find((row) => row.id === m.id);
    queryClient.setQueryData<DealMilestone[]>(
      key,
      (rows) => rows && applyMilestonePatch(rows, m.id, { status: 'completed' })
    );
    try {
      await call(
        `/api/deals/${dealId}/milestones/${m.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status: 'completed', source: 'web' }),
        },
        'Could not update the milestone'
      );
    } catch (err) {
      if (previousRow) {
        queryClient.setQueryData<DealMilestone[]>(
          key,
          (rows) => rows && withMilestoneRow(rows, previousRow)
        );
      }
      toast.error(
        err instanceof Error ? err.message : 'Could not update the milestone'
      );
    } finally {
      if (release(m.id)) {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: key }),
          queryClient.invalidateQueries({ queryKey: ['deal-events', dealId] }),
          queryClient.invalidateQueries({
            queryKey: ['transaction-workspace-index'],
          }),
        ]);
      }
    }
  }

  async function completeTask(task: OverviewTask) {
    lock(task.id);
    try {
      await call(
        `/api/todos/${task.id}`,
        { method: 'PUT', body: JSON.stringify({ completed: true }) },
        'Could not update the task'
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['deal-tasks', dealId] }),
        queryClient.invalidateQueries({ queryKey: ['deal-events', dealId] }),
      ]);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not update the task'
      );
    } finally {
      release(task.id);
    }
  }

  const milestoneRows = milestones.data ?? [];
  const progress = milestoneProgress(milestoneRows);
  const nextMilestone =
    [...milestoneRows]
      .filter((m) => m.status === 'pending' || m.status === 'in_progress')
      .sort((a, b) => a.position - b.position)[0] ?? null;

  const openTasks = (tasks.data ?? []).filter((t) => !t.completed);
  const latestEvent = events.data?.[0] ?? null;
  const people = stakeholders.data ?? [];

  const totalBrokerage =
    deal.brokerage_amount ??
    brokerageAmount({
      dealValue: deal.value,
      type: deal.brokerage_type,
      value: deal.brokerage_value,
    });
  const coBrokerPayouts = Number(deal.co_broker_payout_total ?? 0);
  const collected = Number(financials.data?.brokerage_received_amount ?? 0);
  const token = financials.data?.token;
  const tokenSafe = financials.data?.token_source === 'token_safe';
  const tokenAmount =
    token?.amount != null
      ? formatDealAmount(token.amount, currency)
      : tokenSafe && token?.status
        ? `Escrow ${token.status}`
        : null;
  const tokenReceived = shortDate(token?.received_at);
  const schedule = tranches.data?.summary;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <OverviewCard
        title="Next up"
        tab="milestones"
        tabLabel="Milestones"
        onOpenTab={onOpenTab}
      >
        {milestones.isLoading ? (
          <LoadingRow label="Loading milestones…" />
        ) : milestoneRows.length === 0 ? (
          <EmptyRow label="No closing checklist yet">
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => onOpenTab('milestones')}
            >
              Set up milestones
            </Button>
          </EmptyRow>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{
                    width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                {progress.done} / {progress.total} done
              </p>
            </div>
            {nextMilestone ? (
              <div className="flex items-center gap-3">
                <TickButton
                  label={`Mark ${nextMilestone.title} completed`}
                  disabled={!canEdit || busy.has(nextMilestone.id)}
                  busy={busy.has(nextMilestone.id)}
                  onClick={() => completeMilestone(nextMilestone)}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">
                    {nextMilestone.title}
                  </p>
                  {nextMilestone.target_date && (
                    <p className="text-[11px] text-slate-500">
                      Due {shortDate(nextMilestone.target_date)}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-300">Every milestone is done.</p>
            )}
          </div>
        )}
      </OverviewCard>

      <OverviewCard
        title="Open tasks"
        tab="tasks"
        tabLabel="Tasks"
        onOpenTab={onOpenTab}
      >
        {tasks.isLoading ? (
          <LoadingRow label="Loading tasks…" />
        ) : openTasks.length === 0 ? (
          <EmptyRow label="Nothing to do on this deal" />
        ) : (
          <ul className="space-y-2">
            {openTasks.slice(0, TASK_PREVIEW_LIMIT).map((task) => (
              <li key={task.id} className="flex items-center gap-3">
                <TickButton
                  label={`Complete ${task.title}`}
                  disabled={!canEdit || busy.has(task.id)}
                  busy={busy.has(task.id)}
                  onClick={() => completeTask(task)}
                />
                <div className="min-w-0">
                  <p className="truncate text-sm text-white">{task.title}</p>
                  {task.due_date && (
                    <p className="text-[11px] text-slate-500">
                      Due {shortDate(task.due_date)}
                    </p>
                  )}
                </div>
              </li>
            ))}
            {openTasks.length > TASK_PREVIEW_LIMIT && (
              <li className="text-[11px] text-slate-400">
                and {openTasks.length - TASK_PREVIEW_LIMIT} more
              </li>
            )}
          </ul>
        )}
      </OverviewCard>

      <OverviewCard
        title="Latest on the timeline"
        tab="timeline"
        tabLabel="Timeline"
        onOpenTab={onOpenTab}
      >
        {events.isLoading ? (
          <LoadingRow label="Loading timeline…" />
        ) : !latestEvent ? (
          <EmptyRow label="Nothing recorded yet" />
        ) : (
          <div>
            <p className="text-sm font-medium text-white">
              {latestEvent.event_type === 'note_added' &&
              typeof latestEvent.metadata?.note === 'string'
                ? latestEvent.metadata.note
                : latestEvent.title}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {DEAL_EVENT_LABELS[latestEvent.event_type] ??
                latestEvent.event_type}
              {[
                timelineActorLabel(latestEvent),
                timelineSourceLabel(latestEvent),
              ]
                .filter(Boolean)
                .map((part) => ` · ${part}`)
                .join('')}{' '}
              ·{' '}
              {formatDistanceToNow(new Date(latestEvent.created_at), {
                addSuffix: true,
              })}
            </p>
          </div>
        )}
      </OverviewCard>

      <OverviewCard
        title="People"
        tab="stakeholders"
        tabLabel="Stakeholders"
        onOpenTab={onOpenTab}
      >
        {stakeholders.isLoading ? (
          <LoadingRow label="Loading stakeholders…" />
        ) : people.length === 0 ? (
          <EmptyRow label="Nobody on this deal yet" />
        ) : (
          <div className="space-y-2">
            {STAKEHOLDER_SIDES.map((side) => {
              const onSide = people.filter((p) => p.side === side);
              if (onSide.length === 0) return null;
              return (
                <div key={side}>
                  <p className="text-[11px] text-slate-500">
                    {STAKEHOLDER_SIDE_LABELS[side]}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {onSide.map((p) => (
                      <span
                        key={p.id}
                        className="rounded-full border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-xs text-slate-200"
                      >
                        {p.name} · {STAKEHOLDER_ROLE_LABELS[p.role]}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </OverviewCard>

      <OverviewCard
        title="Money"
        tab="money"
        tabLabel="Money"
        onOpenTab={onOpenTab}
        className="lg:col-span-2"
      >
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <MoneyRow
            label="Deal value"
            value={formatDealAmount(deal.value, currency)}
          />
          <MoneyRow
            label="Brokerage"
            value={formatDealAmount(totalBrokerage, currency)}
            hint={
              deal.brokerage_type === 'percentage' && deal.brokerage_value
                ? `${deal.brokerage_value}% of the deal`
                : undefined
            }
          />
          {coBrokerPayouts > 0 && (
            <MoneyRow
              label="Your share"
              value={formatDealAmount(
                netOfPayouts(totalBrokerage, coBrokerPayouts),
                currency
              )}
              hint={`After ${formatDealAmount(coBrokerPayouts, currency)} to co-brokers`}
            />
          )}
          {financials.isLoading ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <LoadingRow label="Loading financials…" />
            </div>
          ) : (
            <>
              <MoneyRow
                label="Collected"
                value={formatDealAmount(collected, currency)}
              />
              <MoneyRow
                label="Outstanding"
                value={formatDealAmount(
                  Math.max(0, totalBrokerage - collected),
                  currency
                )}
              />
              <MoneyRow
                label="Token"
                value={tokenAmount ?? 'Not yet'}
                hint={
                  tokenReceived
                    ? `Received ${tokenReceived}${tokenSafe ? ' · Token Safe' : ''}`
                    : tokenSafe
                      ? 'Token Safe'
                      : undefined
                }
              />
            </>
          )}
          {tranches.isLoading ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <LoadingRow label="Loading schedule…" />
            </div>
          ) : (
            <MoneyRow
              label="Payment schedule"
              value={
                schedule && schedule.count > 0
                  ? `${formatDealAmount(schedule.received, currency)} received`
                  : 'No tranches yet'
              }
              hint={
                schedule && schedule.count > 0
                  ? `${formatDealAmount(schedule.outstanding, currency)} outstanding`
                  : undefined
              }
            />
          )}
        </dl>
      </OverviewCard>
    </div>
  );
}

function OverviewCard({
  title,
  tab,
  tabLabel,
  onOpenTab,
  className,
  children,
}: {
  title: string;
  tab: TabId;
  tabLabel: string;
  onOpenTab: (tab: TabId) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        'rounded-xl border border-slate-800 bg-slate-900/50 p-4',
        className
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
          {title}
        </h3>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs text-slate-400"
          aria-label={`Open ${tabLabel}`}
          onClick={() => onOpenTab(tab)}
        >
          Open
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
      {children}
    </section>
  );
}

function TickButton({
  label,
  disabled,
  busy,
  onClick,
}: {
  label: string;
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-600 text-transparent transition-colors hover:border-slate-400 hover:text-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
      ) : (
        <Check className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-400">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {label}
    </div>
  );
}

function EmptyRow({
  label,
  children,
}: {
  label: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <p className="text-sm text-slate-400">{label}</p>
      {children}
    </div>
  );
}

function MoneyRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-[11px] text-slate-500 uppercase">{label}</dt>
      <dd className="font-semibold text-white">{value}</dd>
      {hint && <dd className="text-[11px] text-slate-500">{hint}</dd>}
    </div>
  );
}

function useBusyIds() {
  const ids = useRef(new Set<string>());
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const lock = (id: string) => {
    ids.current.add(id);
    setBusy(new Set(ids.current));
  };
  const release = (id: string) => {
    ids.current.delete(id);
    setBusy(new Set(ids.current));
    return ids.current.size === 0;
  };
  return { busy, lock, release };
}
