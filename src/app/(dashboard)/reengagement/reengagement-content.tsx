'use client';

// Standing view across every re-engagement batch, with a filter to drop
// down to one. The per-batch view on the broadcast page renders the same
// outcome panel with a fixed broadcastId.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { loadReengagementBatches } from '@/lib/reengagement/queries';
import { ReengagementOutcome } from '@/components/reengagement/reengagement-outcome';

export default function ReengagementContent() {
  const { accountId } = useAuth();
  const db = createClient();
  const [broadcastId, setBroadcastId] = useState<string | null>(null);

  const batchesQuery = useQuery({
    queryKey: ['reengagement', 'batches', accountId],
    queryFn: () => loadReengagementBatches(db, accountId!),
    enabled: Boolean(accountId),
  });

  const batches = batchesQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">Lead re-engagement</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            What came back from your old portal leads — who replied, who
            restated a requirement, and which inventory now matches them.
          </p>
        </div>

        {batchesQuery.isLoading ? (
          <Loader2 className="size-4 animate-spin text-slate-500" />
        ) : (
          batches.length > 0 && (
            <select
              value={broadcastId ?? ''}
              onChange={(e) => setBroadcastId(e.target.value || null)}
              className="focus:border-primary/50 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
            >
              <option value="">All batches ({batches.length})</option>
              {batches.map((b) => (
                <option key={b.broadcastId} value={b.broadcastId}>
                  {b.name || 'Untitled batch'} ·{' '}
                  {format(new Date(b.sentAt), 'd MMM')} · {b.totalRecipients}{' '}
                  leads
                </option>
              ))}
            </select>
          )
        )}
      </div>

      <ReengagementOutcome broadcastId={broadcastId} />
    </div>
  );
}
