'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Pencil,
  X,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import type {
  Automation,
  AutomationLog,
  AutomationLogStatus,
  AutomationLogStepResult,
} from '@/types';
import { Button, buttonVariants } from '@/components/ui/button';
import { TabSkeleton } from '@/components/dashboard/skeleton';
import { cn } from '@/lib/utils';
import { triggerMeta } from '@/lib/automations/trigger-meta';
import { formatDateTime } from '@/lib/format/date';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
import { useCan } from '@/hooks/useCan';

const LOG_LIMIT = 100;

type StatusFilter = 'all' | AutomationLogStatus;

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'success', label: 'Success' },
  { id: 'failed', label: 'Failed' },
  { id: 'partial', label: 'Waiting' },
];

const STATUS_LABELS: Record<AutomationLogStatus, string> = {
  success: 'Success',
  failed: 'Failed',
  partial: 'Waiting at a Wait step',
};

interface LogsData {
  automation: Automation | null;
  logs: AutomationLog[];
  conversationByContact: Record<string, string>;
}

async function loadLogs(id: string): Promise<LogsData> {
  const supabase = createClient();
  const [autRes, logRes] = await Promise.all([
    supabase.from('automations').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('automation_logs')
      .select('*, contact:contacts(id, name, phone, name_tag)')
      .eq('automation_id', id)
      .order('created_at', { ascending: false })
      .limit(LOG_LIMIT),
  ]);
  if (autRes.error) throw autRes.error;
  if (logRes.error) throw logRes.error;
  const logs = (logRes.data ?? []) as AutomationLog[];

  const contactIds = [
    ...new Set(logs.map((l) => l.contact_id).filter((c): c is string => !!c)),
  ];
  const conversationByContact: Record<string, string> = {};
  if (contactIds.length > 0) {
    const { data } = await supabase
      .from('conversations')
      .select('id, contact_id, last_message_at')
      .in('contact_id', contactIds)
      .order('last_message_at', { ascending: false, nullsFirst: false });
    for (const row of (data ?? []) as { id: string; contact_id: string }[]) {
      if (!conversationByContact[row.contact_id]) {
        conversationByContact[row.contact_id] = row.id;
      }
    }
  }

  return {
    automation: autRes.data as Automation | null,
    logs,
    conversationByContact,
  };
}

export default function AutomationLogsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const canEdit = useCan('make-changes');
  const [openLogId, setOpenLogId] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');

  const logsQuery = useQuery({
    queryKey: ['automation-logs', id],
    queryFn: () => loadLogs(id),
  });

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push('/automations');
  };

  const logs = useMemo(() => logsQuery.data?.logs ?? [], [logsQuery.data]);
  const counts = useMemo(() => {
    const out: Record<StatusFilter, number> = {
      all: logs.length,
      success: 0,
      failed: 0,
      partial: 0,
    };
    for (const log of logs) out[log.status] += 1;
    return out;
  }, [logs]);
  const visible = useMemo(
    () => (filter === 'all' ? logs : logs.filter((l) => l.status === filter)),
    [logs, filter]
  );

  if (logsQuery.isPending) {
    return <TabSkeleton label="Loading automation logs" />;
  }

  if (logsQuery.isError) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <p className="text-sm text-red-400">Couldn&apos;t load these logs.</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => logsQuery.refetch()}>
            Retry
          </Button>
          <Button variant="ghost" onClick={goBack}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  const { automation, conversationByContact } = logsQuery.data;

  if (!automation) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm font-semibold text-white">Automation not found</p>
        <p className="text-xs text-slate-400">
          It may have been deleted, or it belongs to another account.
        </p>
        <Link
          href="/automations"
          className={buttonVariants({ variant: 'outline' })}
        >
          Back to automations
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={goBack}
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold text-white">
            {automation.name}
          </h1>
          <p className="mt-0.5 text-sm text-slate-400">
            Execution logs · {triggerMeta(automation.trigger_type).label}
          </p>
        </div>
        {canEdit && (
          <Link
            href={`/automations/${automation.id}/edit`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Link>
        )}
      </div>

      {logs.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-900/40">
          <p className="text-sm text-white">No executions yet</p>
          <p className="mt-1 text-xs text-slate-400">
            Trigger this automation to see runs here.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={cn(
                    'cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
                    filter === f.id
                      ? 'border-primary bg-primary/10 text-white'
                      : 'border-slate-800 text-slate-400 hover:text-white'
                  )}
                >
                  {f.label} {counts[f.id]}
                </button>
              ))}
            </div>
            {logs.length >= LOG_LIMIT && (
              <p className="text-xs text-slate-400">
                Showing latest {LOG_LIMIT}
              </p>
            )}
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-slate-400">No runs with this status.</p>
          ) : (
            <ul className="space-y-2">
              {visible.map((log) => (
                <LogRow
                  key={log.id}
                  log={log}
                  conversationId={
                    log.contact_id
                      ? (conversationByContact[log.contact_id] ?? null)
                      : null
                  }
                  open={openLogId === log.id}
                  onToggle={() =>
                    setOpenLogId(openLogId === log.id ? null : log.id)
                  }
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function LogRow({
  log,
  conversationId,
  open,
  onToggle,
}: {
  log: AutomationLog;
  conversationId: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  const steps = log.steps_executed ?? [];
  const contactName =
    log.contact?.name ?? log.contact?.phone ?? 'Unknown contact';
  return (
    <li className="rounded-xl border border-slate-800 bg-slate-900">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? 'Hide steps' : 'Show steps'}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          {open ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        <StatusBadge status={log.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-medium text-white">
            {log.contact_id ? (
              <Link
                href={`/contacts?contactId=${log.contact_id}`}
                className="truncate hover:underline"
              >
                {contactName}
              </Link>
            ) : (
              <span className="truncate">{contactName}</span>
            )}
            <NameTagBadge tag={log.contact?.name_tag} />
            {conversationId && (
              <Link
                href={`/inbox?c=${conversationId}`}
                className="inline-flex shrink-0 items-center gap-1 text-xs font-normal text-slate-400 hover:text-white"
              >
                <MessageSquare className="h-3 w-3" />
                Open chat
              </Link>
            )}
          </div>
          <div className="truncate text-xs text-slate-400">
            {triggerMeta(log.trigger_event).label} · {steps.length} step
            {steps.length === 1 ? '' : 's'}
          </div>
        </div>
        <time
          dateTime={log.created_at}
          className="shrink-0 text-xs text-slate-400"
        >
          {formatDateTime(log.created_at)}
        </time>
      </div>
      {open && (
        <div className="border-t border-slate-800 px-4 py-3">
          {log.error_message && (
            <p className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {log.error_message}
            </p>
          )}
          <ul className="space-y-1.5">
            {steps.map((r, i) => (
              <StepRow key={i} result={r} />
            ))}
            {steps.length === 0 && (
              <li className="text-xs text-slate-400">No steps recorded.</li>
            )}
          </ul>
        </div>
      )}
    </li>
  );
}

function StatusBadge({ status }: { status: AutomationLogStatus }) {
  const classes =
    status === 'success'
      ? 'border-primary/30 bg-primary/10 text-primary'
      : status === 'partial'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
        : 'border-red-500/30 bg-red-500/10 text-red-300';
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
        classes
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function StepRow({ result }: { result: AutomationLogStepResult }) {
  const ok = result.status === 'success';
  return (
    <li className="flex items-start gap-2 text-xs">
      <span
        className={cn(
          'mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full',
          ok ? 'bg-primary/20 text-primary' : 'bg-red-500/20 text-red-400'
        )}
        aria-hidden
      >
        {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      </span>
      <span className="text-slate-300">{result.step_type}</span>
      {result.detail && (
        <span className="truncate text-slate-400">— {result.detail}</span>
      )}
    </li>
  );
}
