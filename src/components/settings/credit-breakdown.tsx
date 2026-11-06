'use client';

import { useQuery } from '@tanstack/react-query';
import { Coins, TrendingDown, TrendingUp, CalendarClock } from 'lucide-react';
import { useCredits } from '@/hooks/useCredits';
import { daysUntil } from '@/lib/format/days-until';
import { LoadError } from '@/components/broadcasts/load-error';

interface SummaryResponse {
  totalSpent?: number;
}

interface HistoryResponse {
  transactions?: { amount: number }[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} failed (${res.status})`);
  return (await res.json()) as T;
}

function monthStartIso(): string {
  const since = new Date();
  since.setDate(1);
  since.setHours(0, 0, 0, 0);
  return since.toISOString();
}

function cardValue(
  value: number | undefined,
  pending: boolean,
  failed: boolean
): string {
  if (pending) return '…';
  if (failed || value === undefined) return '—';
  return value.toLocaleString();
}

export function CreditBreakdown() {
  const credits = useCredits();

  const spent = useQuery({
    queryKey: ['credits', 'summary', 'month'],
    queryFn: () =>
      getJson<SummaryResponse>('/api/billing/credits/summary?range=month'),
    select: (json) => json.totalSpent ?? 0,
  });

  const earned = useQuery({
    queryKey: ['credits', 'history', 'earned', 'month'],
    queryFn: () =>
      getJson<HistoryResponse>(
        `/api/billing/credits/history?filter=earned&from=${monthStartIso()}`
      ),
    select: (json) =>
      (json.transactions ?? []).reduce((sum, tx) => sum + tx.amount, 0),
  });

  const resetDays = daysUntil(credits.monthlyResetAt);
  const failed = credits.isError || spent.isError || earned.isError;

  const cards = [
    {
      label: 'Available',
      value: cardValue(
        credits.isLoading || credits.isError ? undefined : credits.total,
        credits.isLoading,
        credits.isError
      ),
      icon: Coins,
      color: 'text-emerald-400 bg-emerald-500/10',
    },
    {
      label: 'Spent this month',
      value: cardValue(spent.data, spent.isPending, spent.isError),
      icon: TrendingDown,
      color: 'text-amber-400 bg-amber-500/10',
    },
    {
      label: 'Earned this month',
      value: cardValue(earned.data, earned.isPending, earned.isError),
      icon: TrendingUp,
      color: 'text-blue-400 bg-blue-500/10',
    },
    {
      label: 'Resets in',
      value: resetDays === null ? '—' : `${resetDays}d`,
      icon: CalendarClock,
      color: 'text-violet-400 bg-violet-500/10',
    },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"
          >
            <div
              className={`inline-flex size-8 items-center justify-center rounded-lg ${card.color}`}
            >
              <card.icon className="size-4" />
            </div>
            <p className="mt-2 text-lg font-bold text-white">{card.value}</p>
            <p className="text-xs text-slate-500">{card.label}</p>
          </div>
        ))}
      </div>
      {failed && (
        <LoadError
          what="your credit balance"
          retrying={spent.isFetching || earned.isFetching}
          onRetry={() => {
            void credits.refresh();
            void spent.refetch();
            void earned.refetch();
          }}
        />
      )}
    </div>
  );
}
