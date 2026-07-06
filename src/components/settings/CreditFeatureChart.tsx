"use client";

import { useEffect, useState } from "react";
import { BarChart } from "@/components/tremor/bar-chart";

type Range = "month" | "30d" | "3m";

const RANGE_LABELS: Record<Range, string> = {
  month: "This month",
  "30d": "Last 30 days",
  "3m": "Last 3 months",
};

const FEATURE_LABELS: Record<string, string> = {
  property_description: "AI Description",
  image_enhance: "AI Image",
  chatbot_classify: "Chat Classify",
  chatbot_auto_reply: "Auto-reply",
  contact_parse: "Contact Parse",
  listing_parse: "Listing Parse",
};

const CATEGORY = "Credits";

export function CreditFeatureChart() {
  const [range, setRange] = useState<Range>("month");
  const [rows, setRows] = useState<{ feature: string; credits: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/billing/credits/summary?range=${range}`)
      .then((res) => res.json())
      .then((json) => setRows(json.features ?? []))
      .finally(() => setLoading(false));
  }, [range]);

  const chartData = rows.map((row) => ({
    feature: FEATURE_LABELS[row.feature] ?? row.feature,
    [CATEGORY]: row.credits,
  }));

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="text-sm font-bold text-white">Spend by AI Feature</h3>
        <div className="flex gap-1">
          {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                range === r ? "bg-primary/20 text-primary" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500 py-8 text-center">Loading...</p>
      ) : chartData.length === 0 ? (
        <p className="text-sm text-slate-500 py-8 text-center">No AI usage in this period.</p>
      ) : (
        <BarChart
          data={chartData}
          index="feature"
          categories={[CATEGORY]}
          colors={["violet"]}
          valueFormatter={(value) => `${value.toLocaleString()} cr`}
          showLegend={false}
          layout="vertical"
          yAxisWidth={110}
          className="h-[220px]"
        />
      )}
    </div>
  );
}
