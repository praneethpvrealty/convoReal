'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { Broadcast } from '@/types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Radio, Plus } from 'lucide-react';
import { SignalWaveLoader } from '@/components/ui/signal-wave-loader';
import { ConvoRealLoader } from '@/components/ui/convoreal-loader';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { getBroadcastStatus } from '@/lib/broadcast-status';
import { InfoHint } from '@/components/ui/info-hint';
import { useAuth } from '@/hooks/use-auth';
import { LoadError } from '@/components/broadcasts/load-error';

/**
 * Poll cadence while any broadcast is sending. Kept modest so we don't
 * beat on Supabase — the aggregate trigger in migration 003 keeps
 * counts consistent; we just need to surface the freshest snapshot.
 */
const POLL_INTERVAL_MS = 5_000;

function percent(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function RateCell({
  value,
  total,
  color,
  draft,
}: {
  value: number;
  total: number;
  /** Tailwind bg class for the fill, e.g. "bg-primary" */
  color: string;
  draft: boolean;
}) {
  if (draft) {
    return <span className="pl-8 text-xs text-slate-500">—</span>;
  }
  const pct = percent(value, total);
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 text-right text-xs text-slate-300 tabular-nums">
        {pct}%
      </span>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-1.5 rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function BroadcastsContent() {
  const router = useRouter();
  const canCreate = useCan('send-messages');
  const { accountId } = useAuth();

  const broadcastsQuery = useQuery({
    queryKey: ['broadcasts', accountId],
    queryFn: async () => {
      const { data, error } = await createClient()
        .from('broadcasts')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Broadcast[];
    },
    enabled: !!accountId,
    refetchInterval: (query) =>
      query.state.data?.some((b) => b.status === 'sending')
        ? POLL_INTERVAL_MS
        : false,
  });

  const broadcasts = useMemo(
    () => broadcastsQuery.data ?? [],
    [broadcastsQuery.data]
  );

  const anySending = useMemo(
    () => broadcasts.some((b) => b.status === 'sending'),
    [broadcasts]
  );

  if (!broadcastsQuery.data && !broadcastsQuery.isError) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-slate-400">
        <SignalWaveLoader
          size={104}
          label="Loading broadcasts"
          className="mb-3"
        />
        <ConvoRealLoader size={20} className="mb-2" />
        <p className="text-sm">Loading broadcasts...</p>
      </div>
    );
  }

  if (!broadcastsQuery.data) {
    return (
      <LoadError
        what="broadcasts"
        onRetry={() => broadcastsQuery.refetch()}
        retrying={broadcastsQuery.isFetching}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Top indeterminate progress bar: only visible while a broadcast
          is mid-send. Pure CSS animation so no extra deps. */}
      {anySending && (
        <div
          role="progressbar"
          aria-label="Broadcast in progress"
          className="broadcast-indeterminate fixed inset-x-0 top-0 z-40 h-0.5 overflow-hidden bg-slate-800"
        >
          <div className="broadcast-indeterminate-bar bg-primary h-0.5" />
          <style jsx>{`
            .broadcast-indeterminate-bar {
              width: 33%;
              transform: translateX(-100%);
              animation: broadcast-slide 1.6s cubic-bezier(0.4, 0, 0.2, 1)
                infinite;
            }
            @keyframes broadcast-slide {
              0% {
                transform: translateX(-100%);
              }
              100% {
                transform: translateX(400%);
              }
            }
          `}</style>
        </div>
      )}

      <div className="flex items-start justify-end gap-4">
        <div className="flex items-center gap-2.5">
          <GatedButton
            canAct={canCreate}
            gateReason="create broadcasts"
            onClick={() => router.push('/broadcasts/new')}
            data-tour="new-broadcast"
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            New Broadcast
          </GatedButton>
        </div>
      </div>

      {broadcasts.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-900">
          <Radio className="mb-3 h-10 w-10 text-slate-600" />
          <p className="text-sm font-medium text-white">No broadcasts yet</p>
          <p className="mt-1 text-xs text-slate-400">
            Create your first broadcast to reach your contacts at scale.
          </p>
          <GatedButton
            canAct={canCreate}
            gateReason="create broadcasts"
            onClick={() => router.push('/broadcasts/new')}
            data-tour="new-broadcast"
            className="bg-primary text-primary-foreground hover:bg-primary/90 mt-4"
          >
            <Plus className="h-4 w-4" />
            New Broadcast
          </GatedButton>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800 hover:bg-transparent">
                <TableHead className="text-slate-400">Name</TableHead>
                <TableHead className="hidden text-slate-400 md:table-cell">
                  Template
                </TableHead>
                <TableHead className="hidden text-right text-slate-400 sm:table-cell">
                  Recipients
                </TableHead>
                <TableHead className="hidden text-slate-400 lg:table-cell">
                  <span className="flex items-center">
                    Delivery
                    <InfoHint text="Percentage of messages successfully delivered to recipient devices." />
                  </span>
                </TableHead>
                <TableHead className="hidden text-slate-400 lg:table-cell">
                  <span className="flex items-center">
                    Read
                    <InfoHint text="Percentage of delivered messages that have been opened/read by recipients." />
                  </span>
                </TableHead>
                <TableHead className="text-slate-400">Status</TableHead>
                <TableHead className="hidden text-slate-400 sm:table-cell">
                  Date
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {broadcasts.map((broadcast) => {
                const status = getBroadcastStatus(broadcast.status);
                return (
                  <TableRow
                    key={broadcast.id}
                    className="cursor-pointer border-slate-800 hover:bg-slate-800/50"
                    onClick={() => router.push(`/broadcasts/${broadcast.id}`)}
                  >
                    <TableCell className="font-medium text-white">
                      <Link
                        href={`/broadcasts/${broadcast.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="focus-visible:ring-primary rounded-sm hover:underline focus-visible:ring-2 focus-visible:outline-none"
                      >
                        {broadcast.name}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden text-slate-300 md:table-cell">
                      {broadcast.template_name}
                    </TableCell>
                    <TableCell className="hidden text-right text-slate-300 tabular-nums sm:table-cell">
                      {broadcast.total_recipients}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <RateCell
                        value={broadcast.delivered_count}
                        total={broadcast.total_recipients}
                        color="bg-primary"
                        draft={broadcast.status === 'draft'}
                      />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <RateCell
                        value={broadcast.read_count}
                        total={broadcast.total_recipients}
                        color="bg-blue-500"
                        draft={broadcast.status === 'draft'}
                      />
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${status.classes}`}
                      >
                        {status.pulse && (
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-yellow-400" />
                          </span>
                        )}
                        {status.label}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-slate-400 sm:table-cell">
                      {new Date(broadcast.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
