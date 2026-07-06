"use client";

import Link from "next/link";
import { Coins } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCredits } from "@/hooks/useCredits";
import type { CreditStatus } from "@/lib/credits/types";
import { useTopupModal } from "./topup-modal-context";

const CHIP_CLASSES: Record<CreditStatus, string> = {
  healthy: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  low: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  critical: "border-red-500/40 bg-red-500/10 text-red-300 animate-pulse",
  empty: "border-red-500/40 bg-red-500/10 text-red-300 animate-pulse",
};

const BAR_CLASSES: Record<CreditStatus, string> = {
  healthy: "bg-emerald-500",
  low: "bg-amber-500",
  critical: "bg-red-500",
  empty: "bg-red-500",
};

function BucketRow({ label, value }: { label: string; value: number }) {
  if (value <= 0) return null;
  return (
    <div className="flex items-center justify-between text-xs py-1">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-slate-200">{value.toLocaleString()} cr</span>
    </div>
  );
}

export function CreditMeter() {
  const credits = useCredits();
  const { openTopupModal } = useTopupModal();

  if (credits.isLoading) return null;

  const monthlyCycleTotal = credits.monthly > 0 ? credits.monthly : 1;
  const progressPct = Math.min(100, Math.round((credits.monthly / monthlyCycleTotal) * 100));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Credit balance"
        className={`hidden sm:flex flex-col gap-1 rounded-full border px-2.5 py-1 transition-colors focus:outline-none ${CHIP_CLASSES[credits.status]}`}
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <Coins className="size-3.5" />
          {credits.status === "empty" ? "AI Locked" : `${credits.total.toLocaleString()} cr`}
        </span>
        <span className="h-0.5 w-full rounded-full bg-black/20 overflow-hidden">
          <span className={`block h-full rounded-full ${BAR_CLASSES[credits.status]}`} style={{ width: `${progressPct}%` }} />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="min-w-64 bg-slate-900 text-slate-100 ring-slate-700 p-3"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-white">
            {credits.total.toLocaleString()} credits
          </span>
        </div>
        <div className="divide-y divide-slate-800/60">
          <BucketRow label="Monthly" value={credits.monthly} />
          <BucketRow label="Commitment bonus" value={credits.bonus} />
          <BucketRow label="Referral" value={credits.referral} />
          <BucketRow label="Purchased" value={credits.purchased} />
          <BucketRow label="Promo" value={credits.promo} />
          {credits.pendingReferral > 0 && (
            <div className="flex items-center justify-between text-xs py-1">
              <span className="text-slate-500">Referral (pending)</span>
              <span className="font-medium text-slate-500">{credits.pendingReferral.toLocaleString()} cr</span>
            </div>
          )}
        </div>
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            onClick={openTopupModal}
            className="flex-1 rounded-lg bg-primary/10 text-primary text-xs font-semibold py-1.5 hover:bg-primary/20 transition-colors"
          >
            + Buy Credits
          </button>
          <Link
            href="/settings?tab=credits"
            prefetch={false}
            className="flex-1 rounded-lg bg-slate-800 text-slate-200 text-xs font-semibold py-1.5 text-center hover:bg-slate-700 transition-colors"
          >
            View Details
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
