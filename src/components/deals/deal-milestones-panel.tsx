'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  Check,
  ListChecks,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DEAL_MILESTONE_STATUSES,
  DEAL_MILESTONE_STATUS_LABELS,
  milestoneProgress,
  type DealMilestone,
  type DealMilestoneStatus,
} from '@/lib/deals/milestones';
import { cn } from '@/lib/utils';

interface DealMilestonesPanelProps {
  dealId: string;
  canEdit: boolean;
}

export function DealMilestonesPanel({
  dealId,
  canEdit,
}: DealMilestonesPanelProps) {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState('');

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
    setBusyId('standard');
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
      setBusyId(null);
    }
  }

  async function addCustom() {
    const title = newTitle.trim();
    if (!title) return;
    setBusyId('custom');
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
      setBusyId(null);
    }
  }

  async function patch(m: DealMilestone, body: Record<string, unknown>) {
    setBusyId(m.id);
    try {
      await call(
        `/api/deals/${dealId}/milestones/${m.id}`,
        { method: 'PATCH', body: JSON.stringify({ ...body, source: 'web' }) },
        'Could not update the milestone'
      );
      await refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not update the milestone'
      );
    } finally {
      setBusyId(null);
    }
  }

  async function remove(m: DealMilestone) {
    if (!window.confirm(`Remove "${m.title}"?`)) return;
    setBusyId(m.id);
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
      setBusyId(null);
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
              disabled={busyId === 'standard'}
            >
              {busyId === 'standard' ? (
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
            return (
              <li
                key={m.id}
                className={cn(
                  'flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3',
                  done && 'opacity-70'
                )}
              >
                <button
                  type="button"
                  disabled={!canEdit || busyId === m.id}
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
                  <p className="text-[11px] text-slate-500">
                    {DEAL_MILESTONE_STATUS_LABELS[m.status]}
                    {m.target_date ? ` · due ${m.target_date}` : ''}
                    {m.completed_at
                      ? ` · done ${m.completed_at.slice(0, 10)}`
                      : ''}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-2">
                    <select
                      className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-white"
                      value={m.status}
                      disabled={busyId === m.id}
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
                    <label className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                      <CalendarClock className="h-3.5 w-3.5" />
                      <input
                        type="date"
                        className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-white"
                        value={m.target_date ?? ''}
                        disabled={busyId === m.id}
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
                        disabled={busyId === m.id}
                        aria-label="Remove milestone"
                      >
                        <Trash2 className="h-4 w-4" />
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
            disabled={!newTitle.trim() || busyId === 'custom'}
          >
            {busyId === 'custom' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Add
          </Button>
          <Button
            variant="outline"
            onClick={addStandard}
            disabled={busyId === 'standard'}
          >
            <ListChecks className="h-4 w-4" />
            Add missing standard
          </Button>
        </div>
      )}
    </div>
  );
}
