"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Gift } from "lucide-react";
import type { ReferralStatus, ReferralTier } from "@/lib/credits/types";

interface ReferralRow {
  id: string;
  referee_account_id: string;
  status: ReferralStatus;
  referee_plan: string | null;
  passive_earn_months: number;
  signed_up_at: string;
  activated_at: string | null;
  converted_at: string | null;
}

interface ReferralData {
  referralCode: string;
  referralLink: string;
  tier: ReferralTier;
  paidReferralCount: number;
  pendingReferralCredits: number;
  referrals: ReferralRow[];
  passiveEarnMonthsTotal: number;
}

const TIER_CHIP: Record<ReferralTier, string> = {
  bronze: "border-amber-700/40 bg-amber-900/20 text-amber-500",
  silver: "border-slate-400/40 bg-slate-400/10 text-slate-300",
  gold: "border-yellow-500/40 bg-yellow-500/10 text-yellow-400",
  platinum: "border-violet-500/40 bg-violet-500/10 text-violet-300",
};

const STATUS_CHIP: Record<ReferralStatus, string> = {
  pending: "border-slate-600/40 bg-slate-700/20 text-slate-400",
  active: "border-blue-500/40 bg-blue-500/10 text-blue-300",
  converted: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  expired: "border-slate-700/40 bg-slate-800/40 text-slate-500",
  invalid: "border-red-500/40 bg-red-500/10 text-red-400",
};

function daysRemaining(signedUpAt: string): number {
  const activationDeadline = new Date(signedUpAt).getTime() + 7 * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((activationDeadline - Date.now()) / (24 * 60 * 60 * 1000)));
}

export function ReferralHub() {
  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/billing/credits/referral")
      .then((res) => res.json())
      .then(setData)
      .catch(() => toast.error("Failed to load referral data"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">Loading referral data...</div>;
  }
  if (!data) return null;

  function copyLink() {
    if (!data) return;
    navigator.clipboard.writeText(data.referralLink);
    toast.success("Referral link copied!");
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Gift className="size-4 text-primary" />
          <h3 className="text-sm font-bold text-white">Referral Program</h3>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${TIER_CHIP[data.tier]}`}>
          {data.tier}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <input
          readOnly
          value={data.referralLink}
          className="flex-1 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-300"
        />
        <button
          type="button"
          onClick={copyLink}
          className="flex items-center gap-1.5 rounded-lg bg-primary/10 text-primary px-3 py-2 text-xs font-semibold hover:bg-primary/20 transition-colors"
        >
          <Copy className="size-3.5" />
          Copy
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-xs text-slate-500">Paid conversions</p>
          <p className="text-lg font-bold text-white">{data.paidReferralCount}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-xs text-slate-500">Pending activation</p>
          <p className="text-lg font-bold text-white">{data.pendingReferralCredits.toLocaleString()} cr</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-xs text-slate-500">Passive months paid</p>
          <p className="text-lg font-bold text-white">{data.passiveEarnMonthsTotal}</p>
        </div>
      </div>

      <div className="space-y-1.5">
        {data.referrals.length === 0 ? (
          <p className="text-xs text-slate-500 py-4 text-center">No referrals yet — share your link to start earning.</p>
        ) : (
          data.referrals.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-lg border border-slate-800/60 bg-slate-900/30 px-3 py-2">
              <div>
                <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_CHIP[r.status]}`}>
                  {r.status}
                </span>
                {r.status === "pending" && (
                  <span className="ml-2 text-[11px] text-slate-500">unlocks in {daysRemaining(r.signed_up_at)}d</span>
                )}
                {r.status === "converted" && r.referee_plan && (
                  <span className="ml-2 text-[11px] text-slate-500">upgraded to {r.referee_plan}</span>
                )}
              </div>
              <span className="text-[11px] text-slate-500">{new Date(r.signed_up_at).toLocaleDateString()}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
