'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Broadcast, BroadcastRecipient, RecipientStatus } from '@/types';
import { Button } from '@/components/ui/button';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SignalWaveLoader } from '@/components/ui/signal-wave-loader';
import { ConvoRealLoader } from '@/components/ui/convoreal-loader';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ArrowLeft,
  Loader2,
  Users,
  Send,
  CheckCheck,
  Eye,
  AlertCircle,
  MessageCircle,
  Filter,
  Download,
  ChevronDown,
  Trash2,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { ReengagementOutcome } from '@/components/reengagement/reengagement-outcome';
import { isReengagementTemplate } from '@/lib/reengagement/funnel';
import { getBroadcastStatus, getRecipientStatus } from '@/lib/broadcast-status';

interface StatCardProps {
  label: string;
  value: number;
  total?: number;
  icon: React.ReactNode;
  color: string;
}

function StatCard({ label, value, total, icon, color }: StatCardProps) {
  const pct =
    total === undefined
      ? null
      : total > 0
        ? Math.round((value / total) * 100)
        : 0;
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between">
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}
        >
          {icon}
        </div>
        {pct !== null && <span className="text-xs text-slate-500">{pct}%</span>}
      </div>
      <p className="mt-3 text-2xl font-bold text-white">
        {value.toLocaleString()}
      </p>
      <p className="text-xs text-slate-400">{label}</p>
    </div>
  );
}

interface FunnelStep {
  label: string;
  value: number;
  color: string;
}

function FunnelChart({ steps, total }: { steps: FunnelStep[]; total: number }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <h3 className="mb-4 text-sm font-medium text-white">Funnel</h3>
      <div className="space-y-2">
        {steps.map((step) => {
          const pctOfTotal =
            total > 0 ? Math.round((step.value / total) * 100) : 0;
          return (
            <div key={step.label} className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-xs text-slate-400">
                {step.label}
              </span>
              <div className="relative h-7 flex-1 rounded-full bg-slate-800">
                <div
                  className={`h-7 rounded-full ${step.color} transition-[width] duration-500`}
                  style={{
                    width: `${Math.max(5, Math.min(100, pctOfTotal))}%`,
                  }}
                />
                <span className="absolute inset-0 flex items-center px-3 text-xs font-medium text-white">
                  {step.value.toLocaleString()}
                  <span className="ml-2 text-slate-300/80">
                    ({pctOfTotal}%)
                  </span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const POLL_INTERVAL_MS = 5_000;
const RECIPIENTS_POLL_INTERVAL_MS = 15_000;

const RECIPIENT_STATUSES: readonly RecipientStatus[] = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
  'failed',
  'rate_limited',
];

/**
 * CSV export helper — RFC 4180 quoting. Quote every field so
 * commas/newlines/quotes round-trip cleanly.
 */
function toCsv(rows: string[][]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return rows.map((r) => r.map(escape).join(',')).join('\n');
}

function downloadBlob(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function BroadcastDetailPage() {
  const params = useParams();
  const router = useRouter();
  const broadcastId = params.id as string;

  const [statusFilter, setStatusFilter] = useState<RecipientStatus | 'all'>(
    'all'
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const broadcastQuery = useQuery({
    queryKey: ['broadcast', broadcastId],
    queryFn: async () => {
      const { data, error } = await createClient()
        .from('broadcasts')
        .select('*')
        .eq('id', broadcastId)
        .single();
      if (error) throw error;
      return data as Broadcast;
    },
    refetchInterval: (query) =>
      query.state.data?.status === 'sending' ? POLL_INTERVAL_MS : false,
  });

  const isSending = broadcastQuery.data?.status === 'sending';

  const recipientsQuery = useQuery({
    queryKey: ['broadcast-recipients', broadcastId],
    queryFn: async () => {
      const { data, error } = await createClient()
        .from('broadcast_recipients')
        .select('*, contact:contacts(*)')
        .eq('broadcast_id', broadcastId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as BroadcastRecipient[];
    },
    refetchInterval: isSending ? RECIPIENTS_POLL_INTERVAL_MS : false,
  });

  const broadcast = broadcastQuery.data ?? null;
  const recipients = useMemo(
    () => recipientsQuery.data ?? [],
    [recipientsQuery.data]
  );
  const loading = broadcastQuery.isPending || recipientsQuery.isPending;
  const loadError = broadcastQuery.error ?? recipientsQuery.error;

  const filteredRecipients = useMemo(
    () =>
      statusFilter === 'all'
        ? recipients
        : recipients.filter((r) => r.status === statusFilter),
    [recipients, statusFilter]
  );

  function handleExport() {
    if (!broadcast) return;
    const header = [
      'Contact',
      'Phone',
      'Status',
      'Sent At',
      'Delivered At',
      'Read At',
      'Replied At',
      'Error',
    ];
    const rows = recipients.map((r) => [
      r.contact?.name ?? '',
      r.contact?.phone ?? '',
      r.status,
      r.sent_at ?? '',
      r.delivered_at ?? '',
      r.read_at ?? '',
      r.replied_at ?? '',
      r.error_message ?? '',
    ]);
    const csv = toCsv([header, ...rows]);
    const safeName = broadcast.name
      .replace(/[^a-z0-9-_]+/gi, '-')
      .toLowerCase();
    downloadBlob(`broadcast-${safeName}-${broadcastId.slice(0, 8)}.csv`, csv);
  }

  async function handleDelete() {
    setDeleting(true);
    const supabase = createClient();
    // broadcast_recipients cascades on broadcasts.id (migration 001), so a
    // single delete is sufficient — the aggregate trigger in migration 003
    // is defined on broadcast_recipients but fires only on its own row
    // changes, not on a cascaded drop of the parent row.
    const { data: deleted, error: delErr } = await supabase
      .from('broadcasts')
      .delete()
      .eq('id', broadcastId)
      .select('id');
    setDeleting(false);
    if (delErr) {
      toast.error(`Failed to delete: ${delErr.message}`);
      return;
    }
    if (!deleted?.length) {
      toast.error('Failed to delete: the broadcast is no longer there.');
      return;
    }
    toast.success('Broadcast deleted');
    router.push('/broadcasts');
  }

  async function handleRetryFailed() {
    setRetrying(true);
    try {
      const res = await fetch(`/api/broadcasts/${broadcastId}/retry-failed`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Retry failed');

      toast.success(
        `Retried ${data.retried} recipient${data.retried !== 1 ? 's' : ''}: ` +
          `${data.succeeded} sent, ${data.failed} failed` +
          (data.rateLimited > 0
            ? `, ${data.rateLimited} rate-limited (will retry again)`
            : '')
      );

      await Promise.all([broadcastQuery.refetch(), recipientsQuery.refetch()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetrying(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-slate-400">
        <SignalWaveLoader
          size={104}
          label="Loading broadcast"
          className="mb-3"
        />
        <ConvoRealLoader size={20} className="mb-2" />
        <p className="text-sm">Loading broadcast...</p>
      </div>
    );
  }

  if (!broadcast || !recipientsQuery.data) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">
          {loadError instanceof Error
            ? loadError.message
            : 'Broadcast not found'}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void broadcastQuery.refetch();
              void recipientsQuery.refetch();
            }}
          >
            Retry
          </Button>
          <Button variant="outline" onClick={() => router.push('/broadcasts')}>
            Back to Broadcasts
          </Button>
        </div>
      </div>
    );
  }

  const status = getBroadcastStatus(broadcast.status);

  const funnelSteps: FunnelStep[] = [
    { label: 'Sent', value: broadcast.sent_count, color: 'bg-primary' },
    {
      label: 'Delivered',
      value: broadcast.delivered_count,
      color: 'bg-teal-500',
    },
    { label: 'Read', value: broadcast.read_count, color: 'bg-blue-500' },
    {
      label: 'Replied',
      value: broadcast.replied_count,
      color: 'bg-indigo-500',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => router.push('/broadcasts')}
            aria-label="Back to broadcasts"
            title="Back to broadcasts"
            className="border-slate-700"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white">
                {broadcast.name}
              </h1>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${status.classes}`}
              >
                {status.label}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-3 text-sm text-slate-400">
              <span>Template: {broadcast.template_name}</span>
              <span>-</span>
              <span>
                Created {new Date(broadcast.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Retry failed — shown when there are failed or rate-limited recipients */}
          {recipients.some(
            (r) => r.status === 'failed' || r.status === 'rate_limited'
          ) && (
            <Button
              variant="outline"
              size="sm"
              disabled={retrying || broadcast.status === 'sending'}
              onClick={handleRetryFailed}
              className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
            >
              {retrying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              {retrying ? 'Retrying…' : 'Retry failed'}
            </Button>
          )}

          {/* Delete — inline-confirm pattern matches the pipeline-settings
            "Delete Pipeline" flow. Mid-send broadcasts can't be deleted
            because orphaning in-flight Meta messages would leave the
            funnel inconsistent. */}
          {confirmDelete ? (
            <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm">
              <span className="text-red-300">Delete this broadcast?</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="h-7 border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
                className="h-7 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Confirm'}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={broadcast.status === 'sending'}
              onClick={() => setConfirmDelete(true)}
              title={
                broadcast.status === 'sending'
                  ? 'Cannot delete while a broadcast is actively sending'
                  : 'Delete this broadcast'
              }
              className="border-red-500/30 bg-transparent text-red-400 hover:bg-red-500/10 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          )}
        </div>
      </div>

      {/* Stats — 6 cards: Total / Sent / Delivered / Read / Replied / Failed */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Total Recipients"
          value={broadcast.total_recipients}
          icon={<Users className="h-4 w-4" />}
          color="bg-slate-800 text-slate-300"
        />
        <StatCard
          label="Sent"
          value={broadcast.sent_count}
          total={broadcast.total_recipients}
          icon={<Send className="h-4 w-4" />}
          color="bg-primary/10 text-primary"
        />
        <StatCard
          label="Delivered"
          value={broadcast.delivered_count}
          total={broadcast.total_recipients}
          icon={<CheckCheck className="h-4 w-4" />}
          color="bg-teal-500/10 text-teal-400"
        />
        <StatCard
          label="Read"
          value={broadcast.read_count}
          total={broadcast.total_recipients}
          icon={<Eye className="h-4 w-4" />}
          color="bg-blue-500/10 text-blue-400"
        />
        <StatCard
          label="Replied"
          value={broadcast.replied_count}
          total={broadcast.total_recipients}
          icon={<MessageCircle className="h-4 w-4" />}
          color="bg-indigo-500/10 text-indigo-400"
        />
        <StatCard
          label="Failed"
          value={broadcast.failed_count}
          total={broadcast.total_recipients}
          icon={<AlertCircle className="h-4 w-4" />}
          color="bg-red-500/10 text-red-400"
        />
      </div>

      <FunnelChart steps={funnelSteps} total={broadcast.total_recipients} />

      {/* Re-engagement outcome — only for batches sent on the
          enquiry-status template, where the send funnel above is just
          the first half of the story: what matters after it is who
          restated a requirement and what now matches them. */}
      {isReengagementTemplate(broadcast.template_name) && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-medium text-white">
            Re-engagement outcome
          </h2>
          <p className="mt-0.5 mb-4 text-xs text-slate-400">
            What this batch produced downstream — replies, restated
            requirements, and matched inventory ready to shortlist.
          </p>
          <ReengagementOutcome broadcastId={broadcastId} />
        </div>
      )}

      {/* Recipients Table */}
      <div className="rounded-xl border border-slate-800 bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-medium text-white">
            Recipients ({filteredRecipients.length}
            {statusFilter !== 'all' ? ` of ${recipients.length}` : ''})
          </h2>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-slate-700 text-slate-300 hover:bg-slate-800"
                  />
                }
              >
                <Filter className="h-3.5 w-3.5" />
                {statusFilter === 'all'
                  ? 'All statuses'
                  : getRecipientStatus(statusFilter).label}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="border-slate-700 bg-slate-900">
                <DropdownMenuItem
                  onClick={() => setStatusFilter('all')}
                  className={
                    statusFilter === 'all' ? 'text-primary' : 'text-slate-300'
                  }
                >
                  All statuses
                </DropdownMenuItem>
                {RECIPIENT_STATUSES.map((s) => (
                  <DropdownMenuItem
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={
                      statusFilter === s ? 'text-primary' : 'text-slate-300'
                    }
                  >
                    {getRecipientStatus(s).label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={recipients.length === 0}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </Button>
          </div>
        </div>

        {filteredRecipients.length === 0 ? (
          <div className="flex h-32 items-center justify-center">
            <p className="text-sm text-slate-400">
              {recipients.length === 0
                ? 'No recipients found.'
                : 'No recipients match this filter.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-400">Contact</TableHead>
                  <TableHead className="text-slate-400">Phone</TableHead>
                  <TableHead className="text-slate-400">Status</TableHead>
                  <TableHead className="text-slate-400">Sent</TableHead>
                  <TableHead className="text-slate-400">Delivered</TableHead>
                  <TableHead className="text-slate-400">Read</TableHead>
                  <TableHead className="text-slate-400">Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecipients.map((recipient) => {
                  const rStatus = getRecipientStatus(recipient.status);
                  return (
                    <TableRow key={recipient.id} className="border-slate-800">
                      <TableCell className="font-medium text-white">
                        <div className="flex items-center gap-1.5">
                          <span>{recipient.contact?.name ?? 'Unknown'}</span>
                          <NameTagBadge tag={recipient.contact?.name_tag} />
                        </div>
                      </TableCell>
                      <TableCell className="text-slate-300">
                        {recipient.contact?.phone ?? '-'}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${rStatus.classes}`}
                        >
                          {rStatus.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-slate-400">
                        {recipient.sent_at
                          ? new Date(recipient.sent_at).toLocaleString()
                          : '-'}
                      </TableCell>
                      <TableCell className="text-slate-400">
                        {recipient.delivered_at
                          ? new Date(recipient.delivered_at).toLocaleString()
                          : '-'}
                      </TableCell>
                      <TableCell className="text-slate-400">
                        {recipient.read_at
                          ? new Date(recipient.read_at).toLocaleString()
                          : '-'}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-xs text-red-400">
                        {recipient.error_message ?? '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
