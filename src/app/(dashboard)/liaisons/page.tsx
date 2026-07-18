"use client"

import { useSearchParams, useRouter } from "next/navigation";
import { pushUrl } from "@/lib/navigation";
import { useMemo } from "react";
import LiaisonsContent from "./liaisons-content";
import JobsContent from "./jobs-content";
import WorkflowsContent from "./workflows-content";
import { FavoriteButton } from "@/components/layout/favorite-button";

type TabId = "directory" | "jobs" | "workflows";

const TABS: { id: TabId; label: string }[] = [
  { id: "directory", label: "Directory" },
  { id: "jobs", label: "Jobs & Payments" },
  { id: "workflows", label: "Workflows" },
];

export default function LiaisonsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const activeTab = useMemo(() => {
    const tab = searchParams.get("tab") as TabId;
    return TABS.some((t) => t.id === tab) ? tab : "directory";
  }, [searchParams]);

  const tabMeta = useMemo(() => {
    switch (activeTab) {
      case "jobs":
        return { label: "Liaison Jobs", href: "/liaisons?tab=jobs", icon: "Briefcase" };
      case "workflows":
        return { label: "Liaison Workflows", href: "/liaisons?tab=workflows", icon: "Workflow" };
      default:
        return { label: "Liaisons", href: "/liaisons", icon: "Landmark" };
    }
  }, [activeTab]);

  const handleTabChange = (tab: TabId) => {
    pushUrl(router, tab === "directory" ? "/liaisons" : `/liaisons?tab=${tab}`);
  };

  return (
    <div className="space-y-6 relative overflow-hidden">
      {/* Header */}
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
            Liaisons
          </h1>
          <p className="mt-1.5 text-xs sm:text-sm text-slate-400 font-medium leading-relaxed">
            The people who get government work done — khata, EC, registration — with their fees, jobs, and margins.
          </p>
        </div>
        <FavoriteButton label={tabMeta.label} href={tabMeta.href} icon={tabMeta.icon} />
      </div>

      {/* Tab Bar */}
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
        {activeTab === "directory" && <LiaisonsContent />}
        {activeTab === "jobs" && <JobsContent />}
        {activeTab === "workflows" && <WorkflowsContent />}
      </div>
    </div>
  );
}
