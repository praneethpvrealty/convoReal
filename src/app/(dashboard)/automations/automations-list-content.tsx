'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CircleAlert,
  Copy,
  History,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Zap,
} from 'lucide-react';

import { useAuth } from '@/hooks/useAuth';
import { useCan } from '@/hooks/useCan';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TabSkeleton } from '@/components/dashboard/skeleton';
import {
  isTriggerAvailable,
  triggerActivationSentence,
  triggerLabel,
  triggerMeta,
} from '@/lib/automations/trigger-meta';
import { formatRelative } from '@/lib/format/date';
import { cn } from '@/lib/utils';
import type { Automation } from '@/types';

interface ActivationIssue {
  path: string;
  message: string;
}

class ActivationError extends Error {
  issues: ActivationIssue[];
  constructor(message: string, issues: ActivationIssue[]) {
    super(message);
    this.issues = issues;
  }
}

export async function fetchAutomations(): Promise<Automation[]> {
  const res = await fetch('/api/automations');
  if (!res.ok) throw new Error('Failed to load automations');
  const body = (await res.json()) as { automations?: Automation[] };
  return body.automations ?? [];
}

async function readError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    issues?: ActivationIssue[];
  };
  if (Array.isArray(body.issues) && body.issues.length > 0) {
    throw new ActivationError(body.error ?? fallback, body.issues);
  }
  throw new Error(body.error ?? fallback);
}

export default function AutomationsListContent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accountId } = useAuth();
  const canEdit = useCan('make-changes');
  const [issuesById, setIssuesById] = useState<
    Record<string, ActivationIssue[]>
  >({});
  const [pendingDelete, setPendingDelete] = useState<Automation | null>(null);
  const [pendingActivate, setPendingActivate] = useState<Automation | null>(
    null
  );

  const queryKey = ['automations', accountId];
  const automationsQuery = useQuery({
    queryKey,
    queryFn: fetchAutomations,
    enabled: Boolean(accountId),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const toggle = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const res = await fetch(`/api/automations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: active }),
      });
      if (!res.ok) await readError(res, 'Could not update this automation');
      return { id, active };
    },
    onSuccess: ({ id, active }) => {
      setIssuesById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      queryClient.setQueryData<Automation[]>(queryKey, (prev) =>
        prev?.map((a) => (a.id === id ? { ...a, is_active: active } : a))
      );
      toast.success(active ? 'Automation turned on.' : 'Automation paused.');
    },
    onError: (err: Error, { id }) => {
      if (err instanceof ActivationError) {
        setIssuesById((prev) => ({ ...prev, [id]: err.issues }));
        toast.error('Fix the issues listed before turning this on.');
        return;
      }
      toast.error(err.message);
    },
  });

  const duplicate = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/automations/${id}/duplicate`, {
        method: 'POST',
      });
      if (!res.ok) await readError(res, 'Could not duplicate');
    },
    onSuccess: () => {
      toast.success('Duplicated as a paused copy.');
      refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/automations/${id}`, { method: 'DELETE' });
      if (!res.ok) await readError(res, 'Could not delete');
      return id;
    },
    onSuccess: (id) => {
      setPendingDelete(null);
      queryClient.setQueryData<Automation[]>(queryKey, (prev) =>
        prev?.filter((a) => a.id !== id)
      );
      toast.success('Automation deleted.');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const automations = automationsQuery.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          Rules that run on their own when something happens in WhatsApp.
        </p>
        <GatedButton
          canAct={canEdit}
          gateReason="create automations"
          onClick={() => router.push('/automations/new')}
        >
          <Plus className="h-4 w-4" />
          New automation
        </GatedButton>
      </div>

      {automationsQuery.isPending ? (
        <TabSkeleton label="Loading automations" />
      ) : automationsQuery.isError ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-6 text-center">
          <p className="text-sm text-rose-300">
            Couldn&apos;t load your automations.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => automationsQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : automations.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-700 bg-slate-900/40 px-6 py-12 text-center">
          <Zap className="text-primary h-8 w-8" />
          <p className="mt-3 text-sm font-semibold text-white">
            No automations yet
          </p>
          <p className="mt-1 max-w-md text-xs text-slate-400">
            An automation watches for an event, like a new contact or a keyword
            in a message, and then runs the steps you set without anyone lifting
            a finger.
          </p>
          <GatedButton
            canAct={canEdit}
            gateReason="create automations"
            onClick={() => router.push('/automations/new')}
            className="mt-5"
          >
            <Plus className="h-4 w-4" />
            Create your first automation
          </GatedButton>
        </div>
      ) : (
        <ul className="space-y-2">
          {automations.map((automation) => (
            <AutomationRow
              key={automation.id}
              automation={automation}
              canEdit={canEdit}
              issues={issuesById[automation.id] ?? []}
              toggling={
                toggle.isPending && toggle.variables?.id === automation.id
              }
              duplicating={
                duplicate.isPending && duplicate.variables === automation.id
              }
              onToggle={(active) =>
                active
                  ? setPendingActivate(automation)
                  : toggle.mutate({ id: automation.id, active })
              }
              onDuplicate={() => duplicate.mutate(automation.id)}
              onDelete={() => setPendingDelete(automation)}
            />
          ))}
        </ul>
      )}

      <Dialog
        open={pendingActivate !== null}
        onOpenChange={(open) => {
          if (!open) setPendingActivate(null);
        }}
      >
        <DialogContent className="bg-slate-900 text-slate-100">
          <DialogHeader>
            <DialogTitle>Turn on “{pendingActivate?.name}”?</DialogTitle>
            <DialogDescription className="text-slate-400">
              {pendingActivate &&
                triggerActivationSentence(
                  pendingActivate.trigger_type,
                  pendingActivate.trigger_config as Record<string, unknown>
                )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-slate-800 bg-slate-900">
            <Button variant="ghost" onClick={() => setPendingActivate(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!pendingActivate) return;
                toggle.mutate({ id: pendingActivate.id, active: true });
                setPendingActivate(null);
              }}
            >
              Turn on
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setPendingDelete(null);
        }}
      >
        <DialogContent className="bg-slate-900 text-slate-100">
          <DialogHeader>
            <DialogTitle>Delete automation?</DialogTitle>
            <DialogDescription className="text-slate-400">
              &ldquo;{pendingDelete?.name}&rdquo; and its run history will be
              removed. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-slate-800 bg-slate-900">
            <Button
              variant="ghost"
              onClick={() => setPendingDelete(null)}
              disabled={remove.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => pendingDelete && remove.mutate(pendingDelete.id)}
              disabled={remove.isPending}
            >
              {remove.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AutomationRow({
  automation,
  canEdit,
  issues,
  toggling,
  duplicating,
  onToggle,
  onDuplicate,
  onDelete,
}: {
  automation: Automation;
  canEdit: boolean;
  issues: ActivationIssue[];
  toggling: boolean;
  duplicating: boolean;
  onToggle: (active: boolean) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const trigger = triggerMeta(automation.trigger_type);
  const available = isTriggerAvailable(automation.trigger_type);
  const blockedOn = !available && !automation.is_active;
  const runs = automation.execution_count ?? 0;
  const lastRun = automation.last_executed_at
    ? formatRelative(automation.last_executed_at)
    : null;

  return (
    <li className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          title={
            blockedOn
              ? 'This trigger is not yet available, so this automation cannot be turned on. Pick another trigger in the editor.'
              : !canEdit
                ? 'Your access is read-only.'
                : undefined
          }
        >
          <Switch
            checked={automation.is_active}
            onCheckedChange={(checked) => onToggle(checked)}
            disabled={!canEdit || toggling || blockedOn}
            aria-label={`${automation.is_active ? 'Pause' : 'Turn on'} ${automation.name}`}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/automations/${automation.id}/edit`}
              className="truncate text-sm font-semibold text-white hover:underline"
            >
              {automation.name}
            </Link>
            <Badge
              variant="outline"
              className={cn('text-[10px]', trigger.pillClass)}
            >
              {triggerLabel(automation.trigger_type)}
            </Badge>
            {!automation.is_active && (
              <span className="text-[11px] text-slate-400">Paused</span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            {runs.toLocaleString()} {runs === 1 ? 'run' : 'runs'}
            {lastRun && ` · Last run ${lastRun}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {canEdit && (
            <Link
              href={`/automations/${automation.id}/edit`}
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Link>
          )}
          <Link
            href={`/automations/${automation.id}/logs`}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            <History className="h-3.5 w-3.5" />
            Logs
          </Link>
          {canEdit && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={onDuplicate}
                disabled={duplicating}
              >
                {duplicating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                Duplicate
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onDelete}
                className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </>
          )}
        </div>
      </div>
      {issues.length > 0 && (
        <div
          role="alert"
          className="mt-3 space-y-1 rounded-md border border-red-500/30 bg-red-500/5 p-3"
        >
          {issues.map((issue, i) => (
            <p
              key={i}
              className="flex items-start gap-1.5 text-xs text-red-300"
            >
              <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
              {issue.message}
            </p>
          ))}
          <Link
            href={`/automations/${automation.id}/edit`}
            className="text-primary inline-block pt-1 text-xs font-medium hover:underline"
          >
            Fix in the editor
          </Link>
        </div>
      )}
    </li>
  );
}
