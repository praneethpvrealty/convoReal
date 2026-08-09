'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Archive, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type Condition = 'dead_or_opted_out' | 'stale' | 'never_responded';
type Action = 'archive' | 'delete';

interface Counts {
  staleDays: number;
  dead_or_opted_out: number;
  stale: number;
  never_responded: number;
}

const CONDITIONS: Array<{
  id: Condition;
  label: string;
  detail: (days: number) => string;
}> = [
  {
    id: 'dead_or_opted_out',
    label: 'Closed their enquiry',
    detail: () =>
      'Tapped "Close my enquiry" or replied STOP ALERTS. Already excluded from campaigns and matching.',
  },
  {
    id: 'stale',
    label: 'Gone quiet',
    detail: (days) =>
      `No reply, appointment or open deal in ${days} days. Contacts you have only been broadcasting at do not count as active.`,
  },
  {
    id: 'never_responded',
    label: 'Never replied',
    detail: () =>
      'Has never sent you a message. Usually an imported or portal lead that never engaged.',
  },
];

export function ContactCleanupDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Refresh the list after contacts move. */
  onDone: () => void;
}) {
  const [staleDays, setStaleDays] = useState(90);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(false);
  const [condition, setCondition] = useState<Condition | null>(null);
  const [action, setAction] = useState<Action>('archive');
  const [confirmText, setConfirmText] = useState('');
  const [running, setRunning] = useState(false);

  const loadCounts = useCallback(async (days: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/contacts/bulk?staleDays=${days}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load counts');
      setCounts(json.data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load counts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setCondition(null);
    setAction('archive');
    setConfirmText('');
    void loadCounts(staleDays);
    // Re-running on `staleDays` is handled by the debounce below; this
    // effect is the open-the-dialog load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loadCounts]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void loadCounts(staleDays), 400);
    return () => clearTimeout(t);
  }, [staleDays, open, loadCounts]);

  const selectedCount = condition && counts ? counts[condition] : 0;
  const deleting = action === 'delete';
  const confirmed = !deleting || confirmText === 'DELETE';

  const run = async () => {
    if (!condition || selectedCount === 0) return;
    setRunning(true);
    try {
      const res = await fetch('/api/contacts/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          condition,
          staleDays,
          ...(deleting ? { confirm: 'DELETE' } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Cleanup failed');

      const { affected, skipped } = json.data as {
        affected: number;
        skipped: number;
      };
      toast.success(
        `${affected} contact${affected === 1 ? '' : 's'} ${
          deleting ? 'deleted' : 'archived'
        }${skipped > 0 ? ` — ${skipped} skipped` : ''}`
      );
      onDone();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Cleanup failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden border-slate-800 bg-slate-950 text-white">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-white">
            Clean up contacts
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Archive or delete the leads who are no longer live, so the list you
            work from is the one you can actually serve.
          </DialogDescription>
        </DialogHeader>

        <div className="my-2 flex-1 space-y-3 overflow-y-auto">
          {CONDITIONS.map((c) => {
            const count = counts?.[c.id] ?? 0;
            const selected = condition === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCondition(selected ? null : c.id)}
                className={cn(
                  'w-full cursor-pointer rounded-xl border p-4 text-left transition-all',
                  selected
                    ? 'border-primary/60 bg-primary/10'
                    : 'border-slate-800 bg-slate-900/50 hover:border-slate-700'
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-white">
                    {c.label}
                  </span>
                  <span className="text-lg font-bold text-white tabular-nums">
                    {loading ? (
                      <Loader2 className="size-4 animate-spin text-slate-500" />
                    ) : (
                      count
                    )}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {c.detail(counts?.staleDays ?? staleDays)}
                </p>
                {c.id === 'stale' && selected && (
                  <div
                    className="mt-3 flex items-center gap-2"
                    // The row is a button; the input inside it must not
                    // toggle the selection when clicked.
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-xs text-slate-400">Quiet for</span>
                    <Input
                      type="number"
                      min={1}
                      max={3650}
                      value={staleDays}
                      onChange={(e) =>
                        setStaleDays(Math.max(1, Number(e.target.value) || 1))
                      }
                      className="h-8 w-24 border-slate-700 bg-slate-950 text-sm"
                    />
                    <span className="text-xs text-slate-400">days</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="space-y-3 border-t border-slate-800 pt-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAction('archive')}
              className={cn(
                'flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-all',
                action === 'archive'
                  ? 'border-primary/60 bg-primary/10 text-white'
                  : 'border-slate-800 text-slate-400 hover:text-slate-200'
              )}
            >
              <Archive className="size-3.5" />
              Archive
            </button>
            <button
              type="button"
              onClick={() => setAction('delete')}
              className={cn(
                'flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-all',
                action === 'delete'
                  ? 'border-red-500/60 bg-red-500/10 text-red-300'
                  : 'border-slate-800 text-slate-400 hover:text-slate-200'
              )}
            >
              <Trash2 className="size-3.5" />
              Delete
            </button>
          </div>

          <p className="text-xs text-slate-400">
            {deleting
              ? 'Deleting removes the contact and its chat history for good. Deals and campaign records survive without a contact attached.'
              : 'Archiving hides the contact from your list and stops every campaign, digest and match. Nothing is lost and you can restore it from the Archived tab.'}
          </p>

          {deleting && selectedCount > 0 && (
            <div className="space-y-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
              <div className="flex items-start gap-2 text-xs text-red-300">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  This permanently deletes {selectedCount} contact
                  {selectedCount === 1 ? '' : 's'}. Type DELETE to confirm.
                </span>
              </div>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                className="h-8 border-slate-700 bg-slate-950 text-sm"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={running}
          >
            Cancel
          </Button>
          <Button
            onClick={run}
            disabled={
              !condition || selectedCount === 0 || !confirmed || running
            }
            className={cn(deleting && 'bg-red-600 text-white hover:bg-red-500')}
          >
            {running && <Loader2 className="mr-2 size-4 animate-spin" />}
            {deleting ? 'Delete' : 'Archive'}
            {selectedCount > 0 ? ` ${selectedCount}` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
