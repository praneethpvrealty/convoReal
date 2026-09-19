'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Briefcase,
  Layers,
  ListChecks,
  Loader2,
  Search,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/use-auth';
import {
  NOT_YET_TRANSACTION_HINT,
  NOT_YET_TRANSACTION_LABEL,
  isClosingRecord,
  transactionSubtitle,
  transactionTitle,
} from '@/lib/deals/index-row';
import { dealsHref } from '@/lib/deals/routes';
import { formatIndianDigits } from '@/lib/invoices/pdf-text';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

interface IndexRow {
  id: string;
  title: string;
  status: 'open' | 'won' | 'lost';
  value: number | null;
  currency: string | null;
  stage_name: string | null;
  stage_color: string | null;
  contact_name: string | null;
  property_title: string | null;
  property_unit_no: string | null;
  deal_group_id: string | null;
  group_name: string | null;
  source_journey_item_id: string | null;
  milestones_total: number;
  milestones_done: number;
  next_milestone_title: string | null;
  next_milestone_target_date: string | null;
  updated_at: string;
}

type StatusFilter = 'open' | 'won' | 'lost' | 'all';

const FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'open', label: 'Active' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' },
  { id: 'all', label: 'All' },
];

export function TransactionWorkspaceIndex({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { accountId, isViewer, isReadOnly } = useAuth();
  const canEdit = !isViewer && !isReadOnly;
  const [filter, setFilter] = useState<StatusFilter>('open');
  const [query, setQuery] = useState('');
  const [seedingId, setSeedingId] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['transaction-workspace-index', accountId],
    queryFn: async (): Promise<IndexRow[]> => {
      const { data, error } = await supabase.rpc(
        'transaction_workspace_index',
        {
          target_account_id: accountId,
        }
      );
      if (error) throw new Error(error.message);
      return (data ?? []) as IndexRow[];
    },
    enabled: Boolean(accountId),
  });

  async function addStandardMilestones(dealId: string) {
    setSeedingId(dealId);
    try {
      const res = await fetch(`/api/deals/${dealId}/milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: 'standard', source: 'web' }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || 'Could not add milestones');
      }
      await queryClient.invalidateQueries({
        queryKey: ['transaction-workspace-index', accountId],
      });
      toast.success('Standard milestones added.');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not add milestones'
      );
    } finally {
      setSeedingId(null);
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter !== 'all' && row.status !== filter) return false;
      if (!q) return true;
      return [
        row.title,
        row.contact_name,
        row.property_title,
        row.property_unit_no,
        row.group_name,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, filter, query]);

  return (
    <div className="space-y-6">
      {!embedded && (
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            Records
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Every closing record: milestones, timeline, papers, tasks and money
            in one place. Open a journey and convert it once the buyer is
            commercially active.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            placeholder="Search by buyer, property or bundle…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="border-slate-700 bg-slate-950 pl-9"
          />
        </div>
        <div className="flex gap-1 rounded-lg border border-slate-800 bg-slate-900/50 p-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                filter === f.id
                  ? 'bg-primary/15 text-white'
                  : 'text-slate-400 hover:text-white'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading transactions…
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center">
          <Briefcase className="mx-auto h-8 w-8 text-slate-600" />
          <p className="mt-3 text-sm font-medium text-slate-300">
            {rows.length === 0 ? 'No transactions yet' : 'Nothing matches'}
          </p>
          {rows.length === 0 && (
            <p className="mt-1 text-xs text-slate-500">
              Convert a journey from the{' '}
              <Link href={dealsHref('journey')} className="text-primary">
                Journey
              </Link>{' '}
              tab, or add a deal on the{' '}
              <Link href={dealsHref('board')} className="text-primary">
                Board
              </Link>
              .
            </p>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((row) => {
            const pct =
              row.milestones_total > 0
                ? Math.round((row.milestones_done / row.milestones_total) * 100)
                : null;
            const headline = transactionTitle(row);
            const subtitle = transactionSubtitle(row);
            const closingRecord = isClosingRecord(row);
            return (
              <li
                key={row.id}
                className="rounded-xl border border-slate-800 bg-slate-900/50 transition-colors hover:border-slate-600"
              >
                <Link href={`/deals/${row.id}`} className="block p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-white">
                        {headline}
                      </p>
                      {subtitle && (
                        <p className="mt-0.5 truncate text-xs text-slate-400">
                          {subtitle}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {row.group_name && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
                          <Layers className="h-3 w-3" />
                          {row.group_name}
                        </span>
                      )}
                      {row.stage_name && (
                        <span
                          className="rounded-full border px-2 py-0.5 text-[11px]"
                          style={{
                            borderColor: row.stage_color ?? undefined,
                            color: row.stage_color ?? undefined,
                          }}
                        >
                          {row.stage_name}
                        </span>
                      )}
                      <span className="text-sm font-semibold text-white">
                        Rs. {formatIndianDigits(row.value ?? 0, 0)}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                    {pct !== null ? (
                      <>
                        <span className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-800">
                          <span
                            className="block h-full rounded-full bg-emerald-500/70"
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                        <span>
                          {row.milestones_done}/{row.milestones_total}{' '}
                          milestones
                        </span>
                        {row.next_milestone_title && (
                          <span>
                            Next: {row.next_milestone_title}
                            {row.next_milestone_target_date
                              ? ` by ${row.next_milestone_target_date}`
                              : ''}
                          </span>
                        )}
                      </>
                    ) : closingRecord ? (
                      <span>No milestones yet</span>
                    ) : (
                      <span
                        title={NOT_YET_TRANSACTION_HINT}
                        className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-200"
                      >
                        <Sparkles className="h-3 w-3" />
                        {NOT_YET_TRANSACTION_LABEL}
                      </span>
                    )}
                  </div>
                </Link>
                {!closingRecord && canEdit && row.status === 'open' && (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-4 py-3">
                    <p className="text-xs text-slate-500">
                      {NOT_YET_TRANSACTION_HINT}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={seedingId === row.id}
                      onClick={() => void addStandardMilestones(row.id)}
                    >
                      {seedingId === row.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ListChecks className="h-3.5 w-3.5" />
                      )}
                      Add standard milestones
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
