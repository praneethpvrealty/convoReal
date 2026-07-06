"use client";

import { useEffect, useState } from "react";
import { Coins, TrendingDown, TrendingUp, CalendarClock } from "lucide-react";
import { useCredits } from "@/hooks/useCredits";

interface SummaryResponse {
  totalSpent: number;
}

function daysUntil(dateString: string | null): number | null {
  if (!dateString) return null;
  return Math.max(0, Math.ceil((new Date(dateString).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

export function CreditBreakdown() {
  const credits = useCredits();
  const [spentThisMonth, setSpentThisMonth] = useState<number | null>(null);
  const [earnedThisMonth, setEarnedThisMonth] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/billing/credits/summary?range=month")
      .then((res) => res.json())
      .then((json: SummaryResponse) => setSpentThisMonth(json.totalSpent ?? 0))
      .catch(() => setSpentThisMonth(0));

    const since = new Date();
    since.setDate(1);
    fetch(`/api/billing/credits/history?filter=earned&from=${since.toISOString()}`)
      .then((res) => res.json())
      .then((json: { transactions?: { amount: number }[] }) =>
        setEarnedThisMonth((json.transactions ?? []).reduce((sum, tx) => sum + tx.amount, 0)),
      )
      .catch(() => setEarnedThisMonth(0));
  }, []);

  const resetDays = daysUntil(credits.monthlyResetAt);

  const cards = [
    { label: "Available", value: credits.total.toLocaleString(), icon: Coins, color: "text-emerald-400 bg-emerald-500/10" },
    { label: "Spent this month", value: spentThisMonth === null ? "…" : spentThisMonth.toLocaleString(), icon: TrendingDown, color: "text-amber-400 bg-amber-500/10" },
    { label: "Earned this month", value: earnedThisMonth === null ? "…" : earnedThisMonth.toLocaleString(), icon: TrendingUp, color: "text-blue-400 bg-blue-500/10" },
    { label: "Resets in", value: resetDays === null ? "—" : `${resetDays}d`, icon: CalendarClock, color: "text-violet-400 bg-violet-500/10" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className={`inline-flex size-8 items-center justify-center rounded-lg ${card.color}`}>
            <card.icon className="size-4" />
          </div>
          <p className="mt-2 text-lg font-bold text-white">{card.value}</p>
          <p className="text-xs text-slate-500">{card.label}</p>
        </div>
      ))}
    </div>
  );
}
