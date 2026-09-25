'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Layers, Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface BatchImportCardProps {
  onChanged: () => void;
}

interface GuidanceBatch {
  id: string;
  model: string;
  key_label: string;
  state: 'pending' | 'applying' | 'applied' | 'failed';
  request_count: number;
  failed_count: number;
  error: string | null;
  created_at: string;
  applied_at: string | null;
}

interface BatchOverview {
  batches: GuidanceBatch[];
  waiting: number;
}

const QUERY_KEY = ['admin-guidance-batches'];

const STATE_LABELS: Record<GuidanceBatch['state'], string> = {
  pending: 'Waiting on Gemini',
  applying: 'Saving rates',
  applied: 'Done',
  failed: 'Failed',
};

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.error ?? `Request failed (${res.status})`;
}

async function post(action: 'queue' | 'check') {
  const res = await fetch('/api/admin/guidance-values/batches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()).data;
}

export function BatchImportCard({ onChanged }: BatchImportCardProps) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<'queue' | 'check' | null>(null);

  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<BatchOverview> => {
      const res = await fetch('/api/admin/guidance-values/batches');
      if (!res.ok) throw new Error(await readError(res));
      return (await res.json()).data;
    },
    refetchInterval: 60_000,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    onChanged();
  };

  const queue = async () => {
    setBusy('queue');
    try {
      let sources = 0;
      let batches = 0;
      for (;;) {
        const result = await post('queue');
        sources += result.sources;
        batches += result.batches;
        if (!result.remaining || !result.sources) break;
      }
      toast.success(
        sources
          ? `Queued ${sources} notifications in ${batches} batch${batches === 1 ? '' : 'es'}`
          : 'Nothing waiting to queue'
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Queuing failed');
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const check = async () => {
    setBusy('check');
    try {
      const result = await post('check');
      toast.success(
        result.applied
          ? `${result.applied} batch${result.applied === 1 ? '' : 'es'} saved`
          : result.running
            ? 'Still running at Gemini'
            : 'No batches waiting'
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Check failed');
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const waiting = data?.waiting ?? 0;
  const batches = data?.batches ?? [];

  return (
    <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <div>
        <h2 className="text-lg font-bold text-white">
          Half-price batch reading
        </h2>
        <p className="text-sm text-slate-400">
          Sends every unfinished notification to Gemini as a batch at half the
          price. Results usually arrive within a few hours (at most a day) and
          are saved automatically; this page does not need to stay open.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={queue} disabled={busy !== null || waiting === 0}>
          {busy === 'queue' ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Layers className="mr-1 h-4 w-4" />
          )}
          Queue {waiting} waiting
        </Button>
        <Button variant="outline" onClick={check} disabled={busy !== null}>
          {busy === 'check' ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-4 w-4" />
          )}
          Check now
        </Button>
      </div>
      {batches.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-400">
              <tr>
                <th className="py-1 pr-3">Queued</th>
                <th className="py-1 pr-3">Page ranges</th>
                <th className="py-1 pr-3">Model</th>
                <th className="py-1 pr-3">State</th>
              </tr>
            </thead>
            <tbody className="text-slate-200">
              {batches.map((batch) => (
                <tr key={batch.id} className="border-t border-slate-800">
                  <td className="py-1 pr-3">
                    {new Date(batch.created_at).toLocaleString()}
                  </td>
                  <td className="py-1 pr-3">
                    {batch.request_count}
                    {batch.failed_count > 0 &&
                      ` (${batch.failed_count} unread)`}
                  </td>
                  <td className="py-1 pr-3">{batch.model}</td>
                  <td className="py-1 pr-3" title={batch.error ?? undefined}>
                    {STATE_LABELS[batch.state]}
                    {batch.state === 'failed' && batch.error
                      ? `: ${batch.error}`
                      : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
