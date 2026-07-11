"use client"

import { useSearchParams, useRouter } from "next/navigation";
import { useMemo } from "react";
import DashboardContent from "./dashboard-content";
import TodayPage from "../today/today-content";
import MatchRadarPage from "../radar/radar-content";
import PulsePage from "../pulse/pulse-content";
import { FavoriteButton } from "@/components/layout/favorite-button";

type TabId = "overview" | "today" | "radar" | "pulse";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "today", label: "Today" },
  { id: "radar", label: "Match Radar" },
  { id: "pulse", label: "Pulse" },
];

export default function DashboardPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const activeTab = useMemo(() => {
    const tab = searchParams.get("tab") as TabId;
    return TABS.some((t) => t.id === tab) ? tab : "overview";
  }, [searchParams]);

  const tabMeta = useMemo(() => {
    switch (activeTab) {
      case "today":
        return { label: "Today", href: "/dashboard?tab=today", icon: "Sun" };
      case "radar":
        return { label: "Match Radar", href: "/dashboard?tab=radar", icon: "Radar" };
      case "pulse":
        return { label: "Pulse", href: "/dashboard?tab=pulse", icon: "Activity" };
      case "overview":
      default:
        return { label: "Dashboard", href: "/dashboard", icon: "LayoutDashboard" };
    }
  }, [activeTab]);

  const handleTabChange = (tab: TabId) => {
    router.push(`/dashboard?tab=${tab}`, { scroll: false });
  };

  return (
    <div className="space-y-6 relative overflow-hidden">
      {/* Header */}
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
            Dashboard
          </h1>
          <p className="mt-1.5 text-xs sm:text-sm text-slate-400 font-medium leading-relaxed">
            Access your daily actions, metrics feed, match notifications, and visitors activity.
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
            data-tour={`dashboard-tab-${tab.id}`}
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
        {activeTab === "overview" && <DashboardContent />}
        {activeTab === "today" && <TodayPage />}
        {activeTab === "radar" && <MatchRadarPage />}
        {activeTab === "pulse" && <PulsePage />}
      </div>
    </div>
  );
}
