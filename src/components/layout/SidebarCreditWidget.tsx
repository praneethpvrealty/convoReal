'use client';

import { Coins } from 'lucide-react';
import Link from 'next/link';
import { useCredits } from '@/hooks/useCredits';
import type { CreditStatus } from '@/lib/credits/types';
import { useTopupModal } from './topup-modal-context';

const BAR_CLASSES: Record<CreditStatus, string> = {
  healthy: 'bg-emerald-500',
  low: 'bg-amber-500',
  critical: 'bg-red-500',
  empty: 'bg-red-500',
};

function daysUntil(dateString: string | null): number | null {
  if (!dateString) return null;
  const diffMs = new Date(dateString).getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

export function SidebarCreditWidget() {
  const credits = useCredits();
  const { openTopupModal } = useTopupModal();

  if (credits.isLoading) return null;

  const resetDays = daysUntil(credits.monthlyResetAt);
  const monthlyCycleTotal = credits.monthly > 0 ? credits.monthly : 1;
  const progressPct = Math.min(
    100,
    Math.round((credits.monthly / monthlyCycleTotal) * 100)
  );

  return (
    <div className="mx-1 mb-3 rounded-xl border border-slate-900/60 bg-slate-900/30 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-bold text-slate-300">
        <Coins className="size-3.5" />
        Credits
      </div>
      <p className="text-lg leading-tight font-black text-white">
        {credits.total.toLocaleString()}
        <span className="ml-1 text-xs font-medium text-slate-500">cr</span>
      </p>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full ${BAR_CLASSES[credits.status]}`}
          style={{ width: `${progressPct}%` }}
        />
      </div>
      {resetDays !== null && (
        <p className="mt-1.5 text-[10px] text-slate-500">
          Resets in {resetDays}d
        </p>
      )}
      <div className="mt-2.5 flex gap-1.5">
        <Link
          href="/settings?tab=credits"
          prefetch={false}
          className="flex-1 rounded-lg bg-slate-800/60 py-1.5 text-center text-[11px] font-semibold text-slate-200 transition-colors hover:bg-slate-800"
        >
          Usage
        </Link>
        <button
          type="button"
          onClick={openTopupModal}
          className="bg-primary/10 text-primary hover:bg-primary/20 flex-1 rounded-lg py-1.5 text-[11px] font-semibold transition-colors"
        >
          + Top Up
        </button>
      </div>
    </div>
  );
}
