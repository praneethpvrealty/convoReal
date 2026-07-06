"use client";

import { Coins } from "lucide-react";
import Link from "next/link";
import { useCredits } from "@/hooks/useCredits";
import type { CreditStatus } from "@/lib/credits/types";
import { useTopupModal } from "./topup-modal-context";

const BAR_CLASSES: Record<CreditStatus, string> = {
  healthy: "bg-emerald-500",
  low: "bg-amber-500",
  critical: "bg-red-500",
  empty: "bg-red-500",
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
  const progressPct = Math.min(100, Math.round((credits.monthly / monthlyCycleTotal) * 100));

  return (
    <div className="mx-1 mb-3 rounded-xl border border-slate-900/60 bg-slate-900/30 p-3">
      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300 mb-1">
        <Coins className="size-3.5" />
        Credits
      </div>
      <p className="text-lg font-black text-white leading-tight">
        {credits.total.toLocaleString()}
        <span className="text-xs font-medium text-slate-500 ml-1">cr</span>
      </p>
      <div className="h-1 w-full rounded-full bg-slate-800 overflow-hidden mt-2">
        <div className={`h-full rounded-full ${BAR_CLASSES[credits.status]}`} style={{ width: `${progressPct}%` }} />
      </div>
      {resetDays !== null && (
        <p className="text-[10px] text-slate-500 mt-1.5">Resets in {resetDays}d</p>
      )}
      <div className="flex gap-1.5 mt-2.5">
        <Link
          href="/settings?tab=credits"
          prefetch={false}
          className="flex-1 rounded-lg bg-slate-800/60 text-slate-200 text-[11px] font-semibold py-1.5 text-center hover:bg-slate-800 transition-colors"
        >
          Usage
        </Link>
        <button
          type="button"
          onClick={openTopupModal}
          className="flex-1 rounded-lg bg-primary/10 text-primary text-[11px] font-semibold py-1.5 hover:bg-primary/20 transition-colors"
        >
          + Top Up
        </button>
      </div>
    </div>
  );
}
