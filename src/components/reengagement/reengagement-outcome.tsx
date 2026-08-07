'use client';

// The re-engagement outcome report. Rendered in two places from one
// component: scoped to a single batch on the broadcast detail page, and
// across every batch on /reengagement. `broadcastId === null` means all
// batches, which is exactly what the RPCs take.

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Loader2, Send, Users, Filter, MessageSquare } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  loadReengagementSummary,
  loadReengagementLeads,
  LEADS_PAGE_SIZE,
  type ReengagementLead,
} from '@/lib/reengagement/queries';
import {
  funnelStages,
  leadStage,
  requirementSummary,
  LEAD_STAGE_LABELS,
  type LeadStage,
} from '@/lib/reengagement/funnel';
import { ShortlistDialog } from './shortlist-dialog';

interface ReengagementOutcomeProps {
  /** One batch, or null for every re-engagement batch. */
  broadcastId?: string | null;
}

const STAGE_STYLES: Record<LeadStage, string> = {
  matched: 'bg-primary/10 text-primary border-primary/20',
  updated: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  replied: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  delivered: 'bg-slate-700/40 text-slate-300 border-slate-600/40',
  sent: 'bg-slate-800/60 text-slate-400 border-slate-700/50',
  failed: 'bg-red-500/10 text-red-400 border-red-500/20',
  pending: 'bg-slate-800/60 text-slate-500 border-slate-700/50',
};

export function ReengagementOutcome({
  broadcastId = null,
}: ReengagementOutcomeProps) {
  const { accountId } = useAuth();
  const db = createClient();
  const enabled = Boolean(accountId);

  const [onlyMatched, setOnlyMatched] = useState(false);
  const [page, setPage] = useState(0);
  const [shortlistLead, setShortlistLead] = useState<ReengagementLead | null>(
    null
  );

  const summaryQuery = useQuery({
    queryKey: ['reengagement', 'summary', accountId, broadcastId],
    queryFn: () => loadReengagementSummary(db, accountId!, broadcastId),
    enabled,
  });

  const leadsQuery = useQuery({
    queryKey: [
      'reengagement',
      'leads',
      accountId,
      broadcastId,
      onlyMatched,
      page,
    ],
    queryFn: () =>
      loadReengagementLeads(db, accountId!, { broadcastId, onlyMatched, page }),
    enabled,
  });

  function refresh() {
    summaryQuery.refetch();
    leadsQuery.refetch();
  }

  const summary = summaryQuery.data;
  const leads = leadsQuery.data?.leads ?? [];
  const total = leadsQuery.data?.total ?? 0;
  const pageCount = Math.ceil(total / LEADS_PAGE_SIZE);

  if (summaryQuery.isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="text-primary size-5 animate-spin" />
      </div>
    );
  }

  if (summary && summary.leads === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center">
        <Users className="mx-auto size-8 text-slate-600" />
        <p className="mt-3 text-sm font-medium text-white">
          No re-engagement sends yet
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Import a batch of old portal leads from Contacts → Re-engage. Their
          replies, restated requirements and matches will show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Funnel */}
      {summary && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {funnelStages(summary).map((stage) => (
            <div
              key={stage.key}
              title={stage.hint}
              className="rounded-xl border border-slate-800 bg-slate-900/50 p-3"
            >
              <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                {stage.label}
              </p>
              <p className="mt-1 text-xl font-bold text-white">{stage.value}</p>
              <p className="text-[10px] text-slate-500">
                {stage.percent}% of leads
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-400">
          {total} lead{total !== 1 ? 's' : ''}
          {onlyMatched ? ' with matches' : ''}
          {summary && summary.batches > 1
            ? ` across ${summary.batches} batches`
            : ''}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setOnlyMatched((v) => !v);
            setPage(0);
          }}
          className={`h-8 border-slate-700 text-xs hover:bg-slate-800 ${
            onlyMatched ? 'text-primary border-primary/40' : 'text-slate-300'
          }`}
        >
          <Filter className="size-3" />
          {onlyMatched ? 'Showing matched only' : 'Show matched only'}
        </Button>
      </div>

      {/* Leads */}
      {leadsQuery.isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="text-primary size-5 animate-spin" />
        </div>
      ) : leads.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-center">
          <p className="text-sm text-slate-400">
            {onlyMatched
              ? 'No leads have matches yet. They appear here once a lead restates their requirement and Radar finds fitting inventory.'
              : 'No leads to show.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[720px] text-xs">
            <thead>
              <tr className="bg-slate-800/60">
                <th className="px-3 py-2 text-left font-medium text-slate-400">
                  Lead
                </th>
                <th className="px-3 py-2 text-left font-medium text-slate-400">
                  Stage
                </th>
                <th className="px-3 py-2 text-left font-medium text-slate-400">
                  Latest requirement
                </th>
                <th className="px-3 py-2 text-left font-medium text-slate-400">
                  Matches
                </th>
                <th className="px-3 py-2 text-right font-medium text-slate-400">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => {
                const stage = leadStage(lead);
                const requirement = requirementSummary(lead);
                const alreadySent = lead.matchEventStatus === 'sent';
                return (
                  <tr
                    key={`${lead.broadcastId}:${lead.contactId}`}
                    className="border-t border-slate-800/50"
                  >
                    <td className="px-3 py-2">
                      <Link
                        href={`/contacts?contact=${lead.contactId}`}
                        className="font-medium text-white hover:underline"
                      >
                        {lead.contactName?.trim() ||
                          lead.contactPhone ||
                          'Unnamed lead'}
                      </Link>
                      <p className="text-[10px] text-slate-500">
                        {formatDistanceToNow(new Date(lead.batchSentAt), {
                          addSuffix: true,
                        })}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${STAGE_STYLES[stage]}`}
                      >
                        {LEAD_STAGE_LABELS[stage]}
                      </span>
                    </td>
                    <td className="max-w-[240px] px-3 py-2 text-slate-300">
                      {requirement || <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      {lead.matchCount > 0 ? (
                        <span className="font-semibold text-white">
                          {lead.matchCount}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {lead.matchCount > 0 && lead.matchEventId ? (
                        <Button
                          type="button"
                          size="sm"
                          variant={alreadySent ? 'outline' : 'default'}
                          onClick={() => setShortlistLead(lead)}
                          className={
                            alreadySent
                              ? 'h-7 border-slate-700 text-[11px] text-slate-300 hover:bg-slate-800'
                              : 'bg-primary hover:bg-primary/90 text-primary-foreground h-7 text-[11px]'
                          }
                        >
                          <Send className="size-3" />
                          {alreadySent ? 'Send again' : 'Shortlist'}
                        </Button>
                      ) : (
                        <Link
                          href={`/inbox?contact=${lead.contactId}`}
                          className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200"
                        >
                          <MessageSquare className="size-3" />
                          Open chat
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="h-8 border-slate-700 text-xs text-slate-300 hover:bg-slate-800"
          >
            Previous
          </Button>
          <span className="text-xs text-slate-500">
            Page {page + 1} of {pageCount}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page + 1 >= pageCount}
            onClick={() => setPage((p) => p + 1)}
            className="h-8 border-slate-700 text-xs text-slate-300 hover:bg-slate-800"
          >
            Next
          </Button>
        </div>
      )}

      <ShortlistDialog
        lead={shortlistLead}
        onOpenChange={(open) => !open && setShortlistLead(null)}
        onSent={refresh}
      />
    </div>
  );
}
