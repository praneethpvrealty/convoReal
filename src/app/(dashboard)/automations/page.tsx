"use client"

import { useSearchParams, useRouter } from "next/navigation";
import { pushUrl } from "@/lib/navigation";
import { useMemo } from "react";
import PipelinesPage from "../pipelines/pipelines-content";
import FlowsPage from "../flows/flows-content";
import { FavoriteButton } from "@/components/layout/favorite-button";

type TabId = "pipelines" | "flows";

const TABS: { id: TabId; label: string }[] = [
  { id: "pipelines", label: "Pipelines" },
  { id: "flows", label: "Flows" },
];

export default function AutomationsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const activeTab = useMemo(() => {
    const tab = searchParams.get("tab") as TabId;
    return TABS.some((t) => t.id === tab) ? tab : "pipelines";
  }, [searchParams]);

  const tabMeta = useMemo(() => {
    switch (activeTab) {
      case "flows":
        return { label: "Flows", href: "/automations?tab=flows", icon: "Workflow" };
      case "pipelines":
      default:
        return { label: "Pipelines", href: "/automations?tab=pipelines", icon: "GitBranch" };
    }
  }, [activeTab]);

  const handleTabChange = (tab: TabId) => {
    pushUrl(router, `/automations?tab=${tab}`);
  };

  return (
    <div className="space-y-6 relative overflow-hidden">
      {/* Header */}
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
            Automations
          </h1>
          <p className="mt-1.5 text-xs sm:text-sm text-slate-400 font-medium leading-relaxed">
            Manage deal pipeline stages, view boards, and configure automated workflows.
          </p>
        </div>
        <FavoriteButton label={tabMeta.label} href={tabMeta.href} icon={tabMeta.icon} />
      </div>

      {/* Sleek Tab Bar */}
      <div className="flex border-b border-slate-800/80 gap-2 relative z-10">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === tab.id
                ? "border-primary text-white bg-primary/5"
                : "border-transparent text-slate-400 hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Render Active View */}
      <div className="relative z-10">
        {activeTab === "pipelines" && <PipelinesPage />}
        {activeTab === "flows" && <FlowsPage />}
      </div>
    </div>
  );
}
