'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardList, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface DealTask {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: 'low' | 'medium' | 'high';
  completed: boolean;
  deal_id: string | null;
}

interface DealTasksPanelProps {
  dealId: string;
  contactId: string | null;
  propertyId: string | null;
  canEdit: boolean;
}

export function DealTasksPanel({
  dealId,
  contactId,
  propertyId,
  canEdit,
}: DealTasksPanelProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<DealTask['priority']>('medium');
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['deal-tasks', dealId],
    queryFn: async (): Promise<DealTask[]> => {
      const response = await fetch(
        `/api/todos?deal_id=${encodeURIComponent(dealId)}`
      );
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || 'Could not load tasks');
      return Array.isArray(json) ? json : [];
    },
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['deal-tasks', dealId] }),
      queryClient.invalidateQueries({ queryKey: ['deal-events', dealId] }),
    ]);

  async function add() {
    const text = title.trim();
    if (!text) return;
    setBusyId('new');
    try {
      const response = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: text,
          due_date: dueDate
            ? new Date(`${dueDate}T09:00:00`).toISOString()
            : null,
          priority,
          contact_id: contactId,
          property_id: propertyId,
          deal_id: dealId,
        }),
      });
      const json = await response.json();
      if (!response.ok)
        throw new Error(json?.error || 'Could not add the task');
      setTitle('');
      setDueDate('');
      await refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not add the task'
      );
    } finally {
      setBusyId(null);
    }
  }

  async function toggle(task: DealTask) {
    setBusyId(task.id);
    try {
      const response = await fetch(`/api/todos/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !task.completed }),
      });
      const json = await response.json();
      if (!response.ok)
        throw new Error(json?.error || 'Could not update the task');
      await refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not update the task'
      );
    } finally {
      setBusyId(null);
    }
  }

  const open = tasks.filter((t) => !t.completed);
  const done = tasks.filter((t) => t.completed);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white">Tasks</h3>
        <p className="text-xs text-slate-400">
          To-dos on this transaction. They also appear in Calendar and the Today
          tab.
        </p>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="min-w-[200px] flex-1">
            <Input
              placeholder="What needs doing?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void add();
              }}
              className="border-slate-700 bg-slate-950"
            />
          </div>
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-auto border-slate-700 bg-slate-950"
          />
          <select
            className="h-9 rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-white"
            value={priority}
            onChange={(e) =>
              setPriority(e.target.value as DealTask['priority'])
            }
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <Button onClick={add} disabled={!title.trim() || busyId === 'new'}>
            {busyId === 'new' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Add task
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading tasks…
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-8 text-center">
          <ClipboardList className="mx-auto h-8 w-8 text-slate-600" />
          <p className="mt-3 text-sm font-medium text-slate-300">
            No tasks on this deal
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {[...open, ...done].map((task) => (
            <li
              key={task.id}
              className={cn(
                'flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3',
                task.completed && 'opacity-60'
              )}
            >
              <button
                type="button"
                disabled={!canEdit || busyId === task.id}
                onClick={() => toggle(task)}
                aria-label={task.completed ? 'Reopen task' : 'Complete task'}
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors',
                  task.completed
                    ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                    : 'border-slate-600 text-transparent hover:border-slate-400'
                )}
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'text-sm text-white',
                    task.completed && 'line-through'
                  )}
                >
                  {task.title}
                </p>
                <p className="text-[11px] text-slate-500">
                  {task.priority} priority
                  {task.due_date ? ` · due ${task.due_date.slice(0, 10)}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
