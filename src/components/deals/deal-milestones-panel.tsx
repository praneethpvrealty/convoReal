'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ClipboardList,
  ListChecks,
  Loader2,
  Plus,
  Settings2,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  MONEY_MILESTONES,
  earlierOpenMilestones,
  groupMilestonesByPhase,
  isMoneyMilestone,
  milestonesBehindStage,
  suggestedNextStage,
  type MoneyMilestoneKey,
} from '@/lib/deals/closing-phases';
import {
  DEAL_MILESTONE_STATUSES,
  DEAL_MILESTONE_STATUS_LABELS,
  applyMilestonePatch,
  milestoneProgress,
  withMilestoneRow,
  type DealMilestone,
  type DealMilestoneStatus,
  type MilestonePatch,
} from '@/lib/deals/milestones';
import {
  DEAL_VISIBILITIES,
  DEAL_VISIBILITY_LABELS,
  type DealVisibility,
} from '@/lib/deals/visibility';
import { cn } from '@/lib/utils';

import type { FinancialsResponse } from './deal-financials-panel';

interface StageOption {
  id: string;
  name: string;
  position: number;
  stage_type?: string | null;
}

interface DealMilestonesPanelProps {
  dealId: string;
  canEdit: boolean;
  stage?: StageOption | null;
  stages?: StageOption[];
  onMoveStage?: (stageId: string) => void;
  contactId?: string | null;
  propertyId?: string | null;
  currency?: string;
}

interface MoneyPrompt {
  key: MoneyMilestoneKey;
  title: string;
}

function milestoneMeta(m: DealMilestone): string {
  return [
    m.target_date
      ? `Due ${format(parseISO(m.target_date), 'd MMM yyyy')}`
      : null,
    m.completed_at
      ? `Done ${format(parseISO(m.completed_at), 'd MMM yyyy')}`
      : null,
    m.status === 'in_progress' || m.status === 'skipped'
      ? DEAL_MILESTONE_STATUS_LABELS[m.status]
      : null,
    m.visibility && m.visibility !== 'internal'
      ? DEAL_VISIBILITY_LABELS[m.visibility]
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function DealMilestonesPanel({
  dealId,
  canEdit,
  stage = null,
  stages = [],
  onMoveStage,
  contactId = null,
  propertyId = null,
  currency = 'INR',
}: DealMilestonesPanelProps) {
  const queryClient = useQueryClient();
  const { busy, lock, release } = useBusyIds();
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState('');
  const [optionsFor, setOptionsFor] = useState<string | null>(null);
  const [orderPrompt, setOrderPrompt] = useState<{
    target: DealMilestone;
    earlier: DealMilestone[];
  } | null>(null);
  const [moneyPrompt, setMoneyPrompt] = useState<MoneyPrompt | null>(null);
  const [moneyAmount, setMoneyAmount] = useState('');
  const [moneyDate, setMoneyDate] = useState('');
  const [moneyRef, setMoneyRef] = useState('');
  const [savingMoney, setSavingMoney] = useState(false);

  const { data: milestones = [], isLoading } = useQuery({
    queryKey: ['deal-milestones', dealId],
    queryFn: async (): Promise<DealMilestone[]> => {
      const response = await fetch(`/api/deals/${dealId}/milestones`);
      const json = await response.json();
      if (!response.ok)
        throw new Error(json?.error || 'Could not load milestones');
      return json.data ?? [];
    },
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['deal-milestones', dealId] }),
      queryClient.invalidateQueries({ queryKey: ['deal-events', dealId] }),
      queryClient.invalidateQueries({
        queryKey: ['transaction-workspace-index'],
      }),
    ]);

  async function call(path: string, init: RequestInit, failure: string) {
    const response = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) throw new Error(json?.error || failure);
    return json;
  }

  async function addStandard() {
    lock('standard');
    try {
      await call(
        `/api/deals/${dealId}/milestones`,
        {
          method: 'POST',
          body: JSON.stringify({ template: 'standard', source: 'web' }),
        },
        'Could not add milestones'
      );
      await refresh();
      toast.success('Standard milestones added.');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not add milestones'
      );
    } finally {
      release('standard');
    }
  }

  async function addCustom() {
    const title = newTitle.trim();
    if (!title) return;
    lock('custom');
    try {
      await call(
        `/api/deals/${dealId}/milestones`,
        {
          method: 'POST',
          body: JSON.stringify({
            title,
            target_date: newDate || null,
            source: 'web',
          }),
        },
        'Could not add the milestone'
      );
      setNewTitle('');
      setNewDate('');
      await refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not add the milestone'
      );
    } finally {
      release('custom');
    }
  }

  async function patch(
    m: DealMilestone,
    body: MilestonePatch
  ): Promise<boolean> {
    const key = ['deal-milestones', dealId];
    lock(m.id);
    await queryClient.cancelQueries({ queryKey: key });
    const previousRow = queryClient
      .getQueryData<DealMilestone[]>(key)
      ?.find((row) => row.id === m.id);
    queryClient.setQueryData<DealMilestone[]>(
      key,
      (rows) => rows && applyMilestonePatch(rows, m.id, body)
    );
    try {
      await call(
        `/api/deals/${dealId}/milestones/${m.id}`,
        { method: 'PATCH', body: JSON.stringify({ ...body, source: 'web' }) },
        'Could not update the milestone'
      );
      return true;
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
      return false;
    } finally {
      const remaining = release(m.id);
      const stillSaving = queryClient
        .getQueryData<DealMilestone[]>(key)
        ?.some((row) => remaining.has(row.id));
      if (!stillSaving) void refresh();
    }
  }

  async function askForMoney(rows: DealMilestone[]) {
    const money = rows.filter((row) => isMoneyMilestone(row.template_key));
    if (money.length === 0) return;
    const financials = await queryClient
      .fetchQuery({
        queryKey: ['deal-financials', dealId],
        queryFn: async (): Promise<FinancialsResponse> => {
          const json = await call(
            `/api/deals/${dealId}/financials`,
            {},
            'Could not load financials'
          );
          return json.data;
        },
      })
      .catch(() => null);
    if (!financials) return;
    const m = money.find(
      (row) =>
        isMoneyMilestone(row.template_key) &&
        financials[MONEY_MILESTONES[row.template_key].amountField] == null &&
        !(
          row.template_key === 'token_paid' &&
          financials.token_source === 'token_safe'
        )
    );
    if (!m || !isMoneyMilestone(m.template_key)) return;
    setMoneyAmount('');
    setMoneyDate(format(new Date(), 'yyyy-MM-dd'));
    setMoneyRef('');
    setMoneyPrompt({ key: m.template_key, title: m.title });
  }

  async function complete(m: DealMilestone, alsoEarlier: DealMilestone[]) {
    setOrderPrompt(null);
    const done: DealMilestone[] = [];
    for (const earlier of alsoEarlier) {
      if (await patch(earlier, { status: 'completed' })) done.push(earlier);
    }
    if (await patch(m, { status: 'completed' })) done.unshift(m);
    await askForMoney(done);
  }

  function toggle(m: DealMilestone) {
    if (m.status === 'completed') {
      void patch(m, { status: 'pending' });
      return;
    }
    const earlier = earlierOpenMilestones(milestones, m).filter(
      (row) => !busy.has(row.id)
    );
    if (earlier.length > 0) {
      setOrderPrompt({ target: m, earlier });
      return;
    }
    void complete(m, []);
  }

  async function settleBehind(status: 'completed' | 'skipped') {
    const done: DealMilestone[] = [];
    for (const m of behind) {
      if (await patch(m, { status })) done.push(m);
    }
    if (status === 'completed') await askForMoney(done);
  }

  async function saveMoney() {
    if (!moneyPrompt) return;
    const spec = MONEY_MILESTONES[moneyPrompt.key];
    const amount = Number(moneyAmount);
    if (!moneyAmount.trim() || !Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter the amount received.');
      return;
    }
    const body: Record<string, unknown> = {
      [spec.amountField]: amount,
      source: 'web',
    };
    if (spec.dateField && moneyDate) body[spec.dateField] = moneyDate;
    if (spec.refField && moneyRef.trim()) body[spec.refField] = moneyRef.trim();
    setSavingMoney(true);
    try {
      const json = await call(
        `/api/deals/${dealId}/financials`,
        { method: 'PATCH', body: JSON.stringify(body) },
        'Could not save to Money'
      );
      queryClient.setQueryData(['deal-financials', dealId], json.data);
      await queryClient.invalidateQueries({
        queryKey: ['deal-events', dealId],
      });
      setMoneyPrompt(null);
      toast.success(`${spec.amountLabel} saved to Money.`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not save to Money'
      );
    } finally {
      setSavingMoney(false);
    }
  }

  async function makeTask(m: DealMilestone) {
    lock(`task-${m.id}`);
    try {
      await call(
        '/api/todos',
        {
          method: 'POST',
          body: JSON.stringify({
            title: m.title,
            due_date: m.target_date
              ? new Date(`${m.target_date}T09:00:00`).toISOString()
              : null,
            priority: 'medium',
            contact_id: contactId,
            property_id: propertyId,
            deal_id: dealId,
          }),
        },
        'Could not add the task'
      );
      await queryClient.invalidateQueries({
        queryKey: ['deal-tasks', dealId],
      });
      toast.success(`Task added: ${m.title}.`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not add the task'
      );
    } finally {
      release(`task-${m.id}`);
    }
  }

  async function remove(m: DealMilestone) {
    if (!window.confirm(`Remove "${m.title}"?`)) return;
    lock(m.id);
    try {
      await call(
        `/api/deals/${dealId}/milestones/${m.id}`,
        { method: 'DELETE' },
        'Could not remove the milestone'
      );
      await refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not remove the milestone'
      );
    } finally {
      release(m.id);
    }
  }

  const progress = milestoneProgress(milestones);
  const behind = milestonesBehindStage(milestones, stage);
  const nextStage = suggestedNextStage(stages, stage, milestones);
  const groups = groupMilestonesByPhase(milestones);
  const settlingBehind = behind.some((m) => busy.has(m.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Milestones</h3>
          <p className="text-xs text-slate-400">
            The closing checklist, grouped by the stage each step belongs to.
            Ticking a milestone never moves the stage by itself.
          </p>
        </div>
        {milestones.length > 0 && (
          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
            {progress.done} / {progress.total} done
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading milestones…
        </div>
      ) : milestones.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-8 text-center">
          <ListChecks className="mx-auto h-8 w-8 text-slate-600" />
          <p className="mt-3 text-sm font-medium text-slate-300">
            No milestones yet
          </p>
          {canEdit && (
            <Button
              className="mt-4"
              onClick={addStandard}
              disabled={busy.has('standard')}
            >
              {busy.has('standard') ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ListChecks className="h-4 w-4" />
              )}
              Add the standard checklist
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {behind.length > 0 && stage && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-amber-100">
                    {behind.length === 1
                      ? '1 milestone is behind the stage'
                      : `${behind.length} milestones are behind the stage`}
                  </p>
                  <p className="mt-0.5 text-xs text-amber-200/80">
                    The deal is on {stage.name}, but{' '}
                    {behind.map((m) => m.title).join(', ')}{' '}
                    {behind.length === 1 ? 'is' : 'are'} still open.
                  </p>
                  {canEdit && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={settlingBehind}
                        onClick={() => void settleBehind('completed')}
                      >
                        {settlingBehind ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                        Mark them done
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={settlingBehind}
                        onClick={() => void settleBehind('skipped')}
                      >
                        Skip them
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {nextStage && canEdit && onMoveStage && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              <p className="text-sm text-emerald-100">
                Everything for this stage is done. Move the deal to{' '}
                <span className="font-semibold">{nextStage.name}</span>?
              </p>
              <Button size="sm" onClick={() => onMoveStage(nextStage.id)}>
                Move stage
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}
          {groups.map((group) => (
            <section key={group.label} aria-label={group.label}>
              <div className="mb-2 flex items-center gap-3">
                <h4 className="text-[11px] font-semibold tracking-[0.14em] text-slate-400 uppercase">
                  {group.label}
                </h4>
                <span
                  className={cn(
                    'text-[11px]',
                    group.done === group.items.length
                      ? 'text-emerald-400'
                      : 'text-slate-500'
                  )}
                >
                  {group.done} / {group.items.length}
                </span>
                <div className="h-px flex-1 bg-slate-800" />
              </div>
              <ol className="space-y-2">
                {group.items.map((m) => {
                  const done =
                    m.status === 'completed' || m.status === 'skipped';
                  const meta = milestoneMeta(m);
                  const optionsOpen = optionsFor === m.id;
                  return (
                    <li
                      key={m.id}
                      className={cn(
                        'rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3',
                        done && !optionsOpen && 'opacity-70'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          disabled={!canEdit || busy.has(m.id)}
                          onClick={() => toggle(m)}
                          className={cn(
                            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors',
                            m.status === 'completed'
                              ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                              : 'border-slate-600 text-transparent hover:border-slate-400'
                          )}
                          aria-label={
                            m.status === 'completed'
                              ? 'Reopen'
                              : 'Mark completed'
                          }
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <div className="min-w-0 flex-1">
                          <p
                            className={cn(
                              'text-sm font-medium text-white',
                              m.status === 'completed' && 'line-through'
                            )}
                          >
                            {m.title}
                          </p>
                          {meta && (
                            <p className="text-[11px] text-slate-500">{meta}</p>
                          )}
                          {behind.some((b) => b.id === m.id) && (
                            <p className="text-[11px] text-amber-300">
                              Behind the stage
                            </p>
                          )}
                        </div>
                        {canEdit && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() =>
                              setOptionsFor(optionsOpen ? null : m.id)
                            }
                            aria-label={`Options for ${m.title}`}
                            aria-expanded={optionsOpen}
                          >
                            <Settings2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      {canEdit && optionsOpen && (
                        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-800 pt-3">
                          <label className="grid gap-1 text-[11px] text-slate-400">
                            Status
                            <select
                              className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-white"
                              value={m.status}
                              disabled={busy.has(m.id)}
                              onChange={(e) =>
                                patch(m, {
                                  status: e.target.value as DealMilestoneStatus,
                                })
                              }
                            >
                              {DEAL_MILESTONE_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {DEAL_MILESTONE_STATUS_LABELS[s]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="grid gap-1 text-[11px] text-slate-400">
                            Who can see it
                            <select
                              className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-white"
                              value={m.visibility ?? 'internal'}
                              disabled={busy.has(m.id)}
                              onChange={(e) =>
                                patch(m, {
                                  visibility: e.target.value as DealVisibility,
                                })
                              }
                            >
                              {DEAL_VISIBILITIES.map((v) => (
                                <option key={v} value={v}>
                                  {DEAL_VISIBILITY_LABELS[v]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="grid gap-1 text-[11px] text-slate-400">
                            Due
                            <input
                              type="date"
                              className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-white"
                              value={m.target_date ?? ''}
                              disabled={busy.has(m.id)}
                              onChange={(e) =>
                                patch(m, {
                                  target_date: e.target.value || null,
                                })
                              }
                            />
                          </label>
                          {m.status !== 'completed' &&
                            m.status !== 'skipped' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void makeTask(m)}
                                disabled={busy.has(`task-${m.id}`)}
                                className="text-slate-300 hover:text-white"
                              >
                                <ClipboardList className="h-4 w-4" />
                                Make a task
                              </Button>
                            )}
                          {!m.template_key && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => remove(m)}
                              disabled={busy.has(m.id)}
                              className="text-slate-400 hover:text-rose-300"
                            >
                              <Trash2 className="h-4 w-4" />
                              Remove
                            </Button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}

      {canEdit && milestones.length > 0 && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="min-w-[200px] flex-1">
            <Input
              placeholder="Custom milestone…"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="border-slate-700 bg-slate-950"
            />
          </div>
          <Input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="w-auto border-slate-700 bg-slate-950"
          />
          <Button
            onClick={addCustom}
            disabled={!newTitle.trim() || busy.has('custom')}
          >
            {busy.has('custom') ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Add
          </Button>
          <Button
            variant="outline"
            onClick={addStandard}
            disabled={busy.has('standard')}
          >
            <ListChecks className="h-4 w-4" />
            Add missing standard
          </Button>
        </div>
      )}

      <Dialog
        open={orderPrompt !== null}
        onOpenChange={(open) => !open && setOrderPrompt(null)}
      >
        <DialogContent className="border-slate-700 bg-slate-900 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">
              Earlier milestones are still open
            </DialogTitle>
          </DialogHeader>
          {orderPrompt && (
            <div className="space-y-2 text-sm text-slate-300">
              <p>
                {orderPrompt.target.title} comes after{' '}
                {orderPrompt.earlier.length === 1
                  ? 'a milestone that is'
                  : `${orderPrompt.earlier.length} milestones that are`}{' '}
                not done yet:
              </p>
              <ul className="list-disc space-y-0.5 pl-5 text-slate-400">
                {orderPrompt.earlier.map((m) => (
                  <li key={m.id}>{m.title}</li>
                ))}
              </ul>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() =>
                orderPrompt && void complete(orderPrompt.target, [])
              }
            >
              Only this one
            </Button>
            <Button
              onClick={() =>
                orderPrompt &&
                void complete(orderPrompt.target, orderPrompt.earlier)
              }
            >
              Complete them too
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={moneyPrompt !== null}
        onOpenChange={(open) => !open && setMoneyPrompt(null)}
      >
        <DialogContent className="border-slate-700 bg-slate-900 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Record it in Money</DialogTitle>
          </DialogHeader>
          {moneyPrompt && (
            <div className="space-y-3">
              <p className="text-sm text-slate-300">
                {moneyPrompt.title} is done. Save the amount so the Money tab
                and the dashboards agree.
              </p>
              <div>
                <Label htmlFor="milestone-money-amount">
                  {MONEY_MILESTONES[moneyPrompt.key].amountLabel} ({currency})
                </Label>
                <Input
                  id="milestone-money-amount"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={moneyAmount}
                  onChange={(e) => setMoneyAmount(e.target.value)}
                  className="mt-1 border-slate-700 bg-slate-950"
                />
              </div>
              {MONEY_MILESTONES[moneyPrompt.key].dateField && (
                <div>
                  <Label htmlFor="milestone-money-date">Received on</Label>
                  <Input
                    id="milestone-money-date"
                    type="date"
                    value={moneyDate}
                    onChange={(e) => setMoneyDate(e.target.value)}
                    className="mt-1 border-slate-700 bg-slate-950"
                  />
                </div>
              )}
              {MONEY_MILESTONES[moneyPrompt.key].refField && (
                <div>
                  <Label htmlFor="milestone-money-ref">Instrument / UTR</Label>
                  <Input
                    id="milestone-money-ref"
                    value={moneyRef}
                    onChange={(e) => setMoneyRef(e.target.value)}
                    className="mt-1 border-slate-700 bg-slate-950"
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setMoneyPrompt(null)}>
              Later
            </Button>
            <Button onClick={() => void saveMoney()} disabled={savingMoney}>
              {savingMoney && <Loader2 className="h-4 w-4 animate-spin" />}
              Save to Money
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
    const remaining: ReadonlySet<string> = new Set(ids.current);
    setBusy(remaining);
    return remaining;
  };
  return { busy, lock, release };
}
