"use client"

import { useSearchParams, useRouter } from "next/navigation";
import { pushUrl } from "@/lib/navigation";
import { useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import DashboardContent from "./dashboard-content";
import TodayPage from "../today/today-content";
import MatchRadarPage from "../radar/radar-content";
import PulsePage from "../pulse/pulse-content";
import ReengagementContent from "../reengagement/reengagement-content";
import TeamAnalyticsContent from "./team-analytics-content";
import MarketContent from "./market-content";
import { FavoriteButton } from "@/components/layout/favorite-button";

type TabId =
  | "overview"
  | "today"
  | "radar"
  | "pulse"
  | "reengagement"
  | "market"
  | "team";

const BASE_TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "today", label: "Today" },
  { id: "radar", label: "Match Radar" },
  { id: "pulse", label: "Pulse" },
  { id: "reengagement", label: "Re-engagement" },
  { id: "market", label: "Market" },
];

export default function DashboardPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isOrgManager, isOrgLeader } = useAuth();

  const tabs = useMemo(
    () =>
      isOrgManager || isOrgLeader
        ? [...BASE_TABS, { id: "team" as TabId, label: "Team" }]
        : BASE_TABS,
    [isOrgManager, isOrgLeader],
  );

  const activeTab = useMemo(() => {
    const tab = searchParams.get("tab") as TabId;
    return tabs.some((t) => t.id === tab) ? tab : "overview";
  }, [searchParams, tabs]);

  const tabMeta = useMemo(() => {
    switch (activeTab) {
      case "today":
        return { label: "Today", href: "/dashboard?tab=today", icon: "Sun" };
      case "radar":
        return { label: "Match Radar", href: "/dashboard?tab=radar", icon: "Radar" };
      case "pulse":
        return { label: "Pulse", href: "/dashboard?tab=pulse", icon: "Activity" };
      case "reengagement":
        return {
          label: "Re-engagement",
          href: "/dashboard?tab=reengagement",
          icon: "Megaphone",
        };
      case "market":
        return { label: "Market", href: "/dashboard?tab=market", icon: "MapPin" };
      case "team":
        return { label: "Team", href: "/dashboard?tab=team", icon: "Users" };
      case "overview":
      default:
        return { label: "Dashboard", href: "/dashboard", icon: "LayoutDashboard" };
    }
  }, [activeTab]);

  const handleTabChange = (tab: TabId) => {
    pushUrl(router, `/dashboard?tab=${tab}`);
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
        {tabs.map((tab) => (
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
        {activeTab === "reengagement" && <ReengagementContent />}
        {activeTab === "market" && <MarketContent />}
        {activeTab === "team" && <TeamAnalyticsContent />}
      </div>
    </div>
  );
}
