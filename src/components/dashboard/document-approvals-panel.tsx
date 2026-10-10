'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle,
  ChevronRight,
  Clock,
  FileText,
  Mail,
  RefreshCw,
  User,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  documentApprovalCopy,
  documentApprovalStage,
  documentDecisionLabel,
  documentRequestWaitLabel,
  groupDocumentApprovals,
  type DocumentApprovalGroup,
  type DocumentApprovalRow,
} from '@/lib/dashboard/document-approvals';
import { formatDateTime } from '@/lib/format/date';
import { cn } from '@/lib/utils';

type Decision = 'approve' | 'reject';

async function decide(
  row: DocumentApprovalRow,
  action: Decision
): Promise<{ delivered: boolean }> {
  const response = await fetch(
    `/api/properties/${row.property_id}/document-requests`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: row.id, action }),
    }
  );
  const json = await response.json();
  if (!response.ok) throw new Error(json?.error || 'Action failed');
  return { delivered: Boolean(json.delivered) };
}

function propertyHref(row: DocumentApprovalRow): string {
  return `/inventory?propertyId=${encodeURIComponent(row.property_code || row.property_id)}`;
}

export function DocumentApprovalsPanel() {
  const [processing, setProcessing] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const {
    data: rows = [],
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['document-approvals'],
    queryFn: async (): Promise<DocumentApprovalRow[]> => {
      const response = await fetch('/api/document-requests');
      const json = await response.json();
      if (!response.ok)
        throw new Error(json?.error || 'Could not load approvals');
      return json.data || [];
    },
    staleTime: 30_000,
  });

  const now = new Date();
  const { open, decided } = groupDocumentApprovals(rows, now);
  const pendingCount = open.reduce((sum, group) => sum + group.rows.length, 0);

  function markProcessing(ids: string[], busy: boolean) {
    setProcessing((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (busy) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function act(targets: DocumentApprovalRow[], action: Decision) {
    const ids = targets.map((row) => row.id);
    markProcessing(ids, true);
    let delivered = 0;
    let done = 0;
    let failure: string | null = null;
    try {
      for (const row of targets) {
        try {
          const result = await decide(row, action);
          done += 1;
          if (result.delivered) delivered += 1;
        } catch (error) {
          failure = error instanceof Error ? error.message : 'Action failed';
        }
      }
      if (done > 0 && action === 'approve') {
        toast.success(
          targets.length === 1
            ? delivered === 1
              ? 'Approved — secure document link sent on WhatsApp.'
              : 'Approved — WhatsApp delivery needs follow-up.'
            : `Approved ${done} of ${targets.length} — ${delivered} link${delivered === 1 ? '' : 's'} sent on WhatsApp.`
        );
      } else if (done > 0) {
        toast.info(
          targets.length === 1
            ? 'Document request closed.'
            : `Closed ${done} of ${targets.length} document requests.`
        );
      }
      if (failure) toast.error(failure);
      await queryClient.invalidateQueries({ queryKey: ['document-approvals'] });
    } finally {
      markProcessing(ids, false);
    }
  }

  if (rows.length === 0) return null;

  function renderRequest(row: DocumentApprovalRow) {
    const stage = documentApprovalStage(row, now);
    const copy = documentApprovalCopy(row, now);
    const busy = processing.has(row.id);
    const stale = stage === 'stale';
    return (
      <div
        key={row.id}
        className="space-y-1.5 rounded-lg border border-slate-800/80 bg-slate-950/40 p-3"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <p className="truncate font-bold text-white">
              <Link
                href={propertyHref(row)}
                className="hover:text-primary hover:underline"
              >
                {row.property_title}
              </Link>
              {row.property_code && (
                <span className="ml-1.5 font-mono text-[10px] font-medium text-slate-500">
                  {row.property_code}
                </span>
              )}
            </p>
            <p className="flex flex-wrap items-center gap-x-2 text-[10px] text-slate-500">
              <span>Requested {formatDateTime(row.created_at, now)}</span>
              <span
                className={cn(
                  row.document_count === 0 ? 'text-amber-400' : 'text-slate-400'
                )}
              >
                {row.document_count === 0
                  ? 'No documents uploaded'
                  : `${row.document_count} ${row.document_count === 1 ? 'document' : 'documents'}`}
              </span>
            </p>
          </div>
          <span
            className={cn(
              'flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold',
              stale
                ? 'bg-red-500/15 text-red-400'
                : 'bg-amber-500/20 text-amber-400'
            )}
          >
            <Clock className="size-2.5" />
            {documentRequestWaitLabel(row, now)}
          </span>
        </div>
        {copy.hint && (
          <p className="flex items-start gap-1.5 text-[11px] text-amber-400/90">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            <span>
              {copy.hint}
              {row.document_count === 0 && (
                <>
                  {' '}
                  <Link
                    href={propertyHref(row)}
                    className="font-semibold underline underline-offset-2"
                  >
                    Upload documents
                  </Link>
                </>
              )}
            </span>
          </p>
        )}
        <div className="flex items-center justify-end gap-2 pt-0.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-3 text-[11px] text-red-400/80 hover:bg-red-500/10 hover:text-red-400"
            disabled={busy}
            onClick={() => void act([row], 'reject')}
          >
            {copy.reject}
          </Button>
          <Button
            size="sm"
            variant={stale || row.document_count === 0 ? 'outline' : 'default'}
            className="h-7 px-3 text-[11px]"
            disabled={busy}
            onClick={() => void act([row], 'approve')}
          >
            {copy.approve}
          </Button>
        </div>
      </div>
    );
  }

  function renderGroup(group: DocumentApprovalGroup<DocumentApprovalRow>) {
    const busy = group.rows.some((row) => processing.has(row.id));
    const multi = group.rows.length > 1;
    const sendable = group.rows.filter((row) => row.document_count > 0);
    return (
      <div
        key={group.key}
        className="border-slate-850 space-y-2 rounded-xl border bg-slate-900/60 p-3.5 text-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <p className="flex items-center gap-1.5 font-bold text-white">
              <User className="size-3.5 shrink-0 text-slate-400" />
              <span className="truncate">{group.requester_name}</span>
              <span className="font-normal text-slate-400">
                · {group.requester_phone}
              </span>
            </p>
            {group.requester_email && (
              <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <Mail className="size-3 shrink-0" />
                {group.requester_email}
              </p>
            )}
          </div>
          {multi && (
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
              {group.rows.length} properties
            </span>
          )}
        </div>
        <div className="space-y-2">{group.rows.map(renderRequest)}</div>
        {multi && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-800/80 pt-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-3 text-[11px] text-red-400/80 hover:bg-red-500/10 hover:text-red-400"
              disabled={busy}
              onClick={() => void act(group.rows, 'reject')}
            >
              {group.stale ? 'Dismiss all' : 'Reject all'}
            </Button>
            <Button
              size="sm"
              variant={group.stale ? 'outline' : 'default'}
              className="h-7 px-3 text-[11px]"
              disabled={busy || sendable.length === 0}
              onClick={() => void act(sendable, 'approve')}
            >
              {sendable.length === group.rows.length
                ? `Approve all ${group.rows.length}`
                : `Approve ${sendable.length} with documents`}
            </Button>
          </div>
        )}
      </div>
    );
  }

  function renderDecided(row: DocumentApprovalRow) {
    const approved = row.status === 'approved';
    return (
      <div
        key={row.id}
        className="border-slate-850 flex items-start justify-between gap-3 rounded-xl border bg-slate-950/40 p-3 text-xs"
      >
        <div className="min-w-0 space-y-0.5">
          <p className="truncate font-bold text-white">
            <Link
              href={propertyHref(row)}
              className="hover:text-primary hover:underline"
            >
              {row.property_title}
            </Link>
            {row.property_code && (
              <span className="ml-1.5 font-mono text-[10px] font-medium text-slate-500">
                {row.property_code}
              </span>
            )}
          </p>
          <p className="text-slate-400">
            {row.requester_name} · {row.requester_phone}
          </p>
          <p className="text-[10px] text-slate-600">
            Decided {formatDateTime(row.updated_at, now)}
          </p>
        </div>
        <span
          className={cn(
            'flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold',
            approved
              ? 'bg-emerald-500/20 text-emerald-400'
              : 'bg-slate-800 text-slate-400'
          )}
        >
          {approved ? (
            <CheckCircle className="size-2.5" />
          ) : (
            <XCircle className="size-2.5" />
          )}
          {documentDecisionLabel(row)}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold text-white">
          <FileText className="text-primary size-4" />
          Document Access Approvals
          {pendingCount > 0 && (
            <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-black text-black">
              {pendingCount}
            </span>
          )}
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="h-6 px-2 text-slate-500 hover:text-white"
        >
          <RefreshCw className={`size-3 ${isFetching ? 'animate-spin' : ''}`} />
        </Button>
      </div>
      <div className="max-h-96 space-y-2.5 overflow-y-auto pr-1">
        {open.length === 0 && (
          <p className="py-2 text-xs text-slate-500">
            No document requests waiting on you.
          </p>
        )}
        {open.map(renderGroup)}
        {decided.length > 0 && (
          <details className="group/decided">
            <summary className="cursor-pointer list-none py-1 text-[11px] font-semibold text-slate-400 hover:text-white">
              <span className="inline-flex items-center gap-1">
                <ChevronRight className="size-3 transition-transform group-open/decided:rotate-90" />
                Recently decided ({decided.length})
              </span>
            </summary>
            <div className="mt-2 space-y-2.5">{decided.map(renderDecided)}</div>
          </details>
        )}
      </div>
    </div>
  );
}
