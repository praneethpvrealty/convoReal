"use client";

import { Coins } from "lucide-react";
import { CreditBreakdown } from "./CreditBreakdown";
import { CreditFeatureChart } from "./CreditFeatureChart";
import { CreditLedger } from "./CreditLedger";
import { ReferralHub } from "./ReferralHub";
import { useTopupModal } from "@/components/layout/topup-modal-context";

export function CreditsTab() {
  const { openTopupModal } = useTopupModal();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">Credits</h2>
          <p className="text-sm text-slate-400">Manage your AI credit balance, usage, and referrals.</p>
        </div>
        <button
          type="button"
          onClick={openTopupModal}
          className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          <Coins className="size-4" />
          Buy Credits
        </button>
      </div>

      <CreditBreakdown />
      <CreditFeatureChart />
      <CreditLedger />
      <ReferralHub />
    </div>
  );
}
