"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import type { CreditTransaction, CreditTransactionType } from "@/lib/credits/types";

type FilterValue = "all" | "earned" | "spent" | "purchased" | "referral";

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: "all", label: "All" },
  { value: "earned", label: "Earned" },
  { value: "spent", label: "Spent" },
  { value: "purchased", label: "Purchased" },
  { value: "referral", label: "Referral" },
];

const TYPE_COLOR: Record<CreditTransactionType, string> = {
  subscription_grant: "text-emerald-400",
  commitment_bonus: "text-emerald-400",
  referral_signup: "text-emerald-400",
  referral_upgrade: "text-emerald-400",
  referral_passive: "text-emerald-400",
  purchase: "text-yellow-400",
  admin_grant: "text-emerald-400",
  promo: "text-emerald-400",
  ai_burn: "text-purple-400",
  expiry: "text-slate-500",
  refund: "text-blue-400",
};

interface HistoryResponse {
  transactions: CreditTransaction[];
  page: number;
  totalPages: number;
  total: number;
}

export function CreditLedger() {
  const [filter, setFilter] = useState<FilterValue>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/billing/credits/history?filter=${filter}&page=${page}`)
      .then((res) => res.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [filter, page]);

  function handleFilterChange(next: FilterValue) {
    setFilter(next);
    setPage(1);
  }

  function exportCsv() {
    if (!data?.transactions.length) return;
    const rows = [
      ["Date", "Type", "Description", "Amount", "Balance After"],
      ...data.transactions.map((tx) => [
        new Date(tx.created_at).toISOString(),
        tx.type,
        tx.description ?? "",
        String(tx.amount),
        String(tx.balance_after),
      ]),
    ];
    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `credit-transactions-page-${data.page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="text-sm font-bold text-white">Transaction History</h3>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => handleFilterChange(f.value)}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                  filter === f.value ? "bg-primary/20 text-primary" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={exportCsv}
            className="flex items-center gap-1 rounded-md border border-slate-800 px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200 hover:border-slate-700 transition-colors"
          >
            <Download className="size-3" />
            CSV
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500 py-8 text-center">Loading...</p>
      ) : !data?.transactions.length ? (
        <p className="text-sm text-slate-500 py-8 text-center">No transactions yet.</p>
      ) : (
        <>
          <div className="space-y-1">
            {data.transactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-slate-800/30">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-200 truncate">{tx.description ?? tx.type}</p>
                  <p className="text-[10px] text-slate-500">{new Date(tx.created_at).toLocaleString()}</p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className={`text-xs font-bold tabular-nums ${TYPE_COLOR[tx.type]}`}>
                    {tx.amount > 0 ? "+" : ""}
                    {tx.amount.toLocaleString()}
                  </p>
                  <p className="text-[10px] text-slate-500 tabular-nums">bal: {tx.balance_after.toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>

          {data.totalPages > 1 && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-800/60">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="text-xs text-slate-400 disabled:opacity-30 hover:text-white"
              >
                Previous
              </button>
              <span className="text-[11px] text-slate-500">
                Page {data.page} of {data.totalPages}
              </span>
              <button
                type="button"
                disabled={page >= data.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="text-xs text-slate-400 disabled:opacity-30 hover:text-white"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
