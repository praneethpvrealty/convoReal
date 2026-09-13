'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle,
  Clock,
  FileText,
  RefreshCw,
  User,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

interface DocumentApprovalRow {
  id: string;
  property_id: string;
  property_title: string;
  property_code: string | null;
  requester_name: string;
  requester_phone: string;
  requester_email: string | null;
  status: string;
  share_sent_at: string | null;
  created_at: string;
}

function formatWhen(value: string): string {
  return new Date(value).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function DocumentApprovalsPanel() {
  const [processingId, setProcessingId] = useState<string | null>(null);
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

  async function act(row: DocumentApprovalRow, action: 'approve' | 'reject') {
    setProcessingId(row.id);
    try {
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
      if (action === 'approve') {
        toast.success(
          json.delivered
            ? 'Approved — secure document link sent on WhatsApp.'
            : 'Approved — WhatsApp delivery needs follow-up.'
        );
      } else {
        toast.info('Document request rejected.');
      }
      await queryClient.invalidateQueries({ queryKey: ['document-approvals'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Action failed');
    } finally {
      setProcessingId(null);
    }
  }

  if (rows.length === 0) return null;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold text-white">
          <FileText className="text-primary size-4" />
          Document Access Approvals
          {rows.some((row) => row.status === 'pending') && (
            <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-black text-black">
              {rows.filter((row) => row.status === 'pending').length}
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
        {rows.map((row) => (
          <div
            key={row.id}
            className="border-slate-850 space-y-2 rounded-xl border bg-slate-950/40 p-3.5 text-xs"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 space-y-0.5">
                <p className="truncate font-bold text-white">
                  {row.property_title}
                  {row.property_code && (
                    <span className="ml-1.5 font-mono text-[10px] font-medium text-slate-500">
                      {row.property_code}
                    </span>
                  )}
                </p>
                <p className="flex items-center gap-1.5 text-slate-400">
                  <User className="size-3 shrink-0" />
                  {row.requester_name} · {row.requester_phone}
                </p>
                {row.requester_email && (
                  <p className="text-[11px] text-slate-500">
                    {row.requester_email}
                  </p>
                )}
                <p className="text-[10px] text-slate-600">
                  Requested {formatWhen(row.created_at)}
                </p>
              </div>
              {row.status === 'pending' ? (
                <span className="flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                  <Clock className="size-2.5" /> Your decision
                </span>
              ) : row.status === 'approved' ? (
                <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                  <CheckCircle className="size-2.5" />{' '}
                  {row.share_sent_at ? 'Link sent' : 'Approved'}
                </span>
              ) : (
                <span className="flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-400">
                  <XCircle className="size-2.5" /> Rejected
                </span>
              )}
            </div>
            {row.status === 'pending' && (
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  className="h-7 flex-1 text-[11px]"
                  disabled={processingId === row.id}
                  onClick={() => void act(row, 'approve')}
                >
                  Approve &amp; send
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 flex-1 border-red-500/30 text-[11px] text-red-400 hover:bg-red-500/10"
                  disabled={processingId === row.id}
                  onClick={() => void act(row, 'reject')}
                >
                  Reject
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
