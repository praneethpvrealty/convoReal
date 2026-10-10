'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import {
  Check,
  ListChecks,
  Loader2,
  Plus,
  Settings2,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

interface DealMilestonesPanelProps {
  dealId: string;
  canEdit: boolean;
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
}: DealMilestonesPanelProps) {
  const queryClient = useQueryClient();
  const { busy, lock, release } = useBusyIds();
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState('');
  const [optionsFor, setOptionsFor] = useState<string | null>(null);

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

  async function patch(m: DealMilestone, body: MilestonePatch) {
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
      const remaining = release(m.id);
      const stillSaving = queryClient
        .getQueryData<DealMilestone[]>(key)
        ?.some((row) => remaining.has(row.id));
      if (!stillSaving) void refresh();
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Milestones</h3>
          <p className="text-xs text-slate-400">
            The closing checklist. Completing a milestone never moves the
            pipeline stage; the board stays the board.
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
        <ol className="space-y-2">
          {milestones.map((m) => {
            const done = m.status === 'completed' || m.status === 'skipped';
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
                    onClick={() =>
                      patch(m, {
                        status:
                          m.status === 'completed' ? 'pending' : 'completed',
                      })
                    }
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors',
                      m.status === 'completed'
                        ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                        : 'border-slate-600 text-transparent hover:border-slate-400'
                    )}
                    aria-label={
                      m.status === 'completed' ? 'Reopen' : 'Mark completed'
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
                  </div>
                  {canEdit && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setOptionsFor(optionsOpen ? null : m.id)}
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
                          patch(m, { target_date: e.target.value || null })
                        }
                      />
                    </label>
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
