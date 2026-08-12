"use client"

import { useSearchParams, useRouter } from "next/navigation";
import { pushUrl } from "@/lib/navigation";
import { useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import DashboardContent from "./dashboard-content";
import FocusContent from "./focus-content";
import TodayPage from "../today/today-content";
import MatchRadarPage from "../radar/radar-content";
import PulsePage from "../pulse/pulse-content";
import ReengagementContent from "../reengagement/reengagement-content";
import TeamAnalyticsContent from "./team-analytics-content";
import MarketContent from "./market-content";
import { FavoriteButton } from "@/components/layout/favorite-button";

type TabId =
  | "focus"
  | "overview"
  | "radar"
  | "pulse"
  | "reengagement"
  | "market"
  | "team";

// Focus leads and is where an unqualified /dashboard lands: it answers
// "what do I do next?", which is the question an agent opens the app
// with. Overview answers "how are we doing?" — a question you go
// looking for. Focus replaced the Today tab and absorbed its agenda;
// Today's remaining signals render underneath it.
const BASE_TABS: { id: TabId; label: string }[] = [
  { id: "focus", label: "Focus" },
  { id: "overview", label: "Overview" },
  { id: "radar", label: "Match Radar" },
  { id: "pulse", label: "Pulse" },
  { id: "reengagement", label: "Re-engagement" },
  { id: "market", label: "Market" },
];

const DEFAULT_TAB: TabId = "focus";

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
    return tabs.some((t) => t.id === tab) ? tab : DEFAULT_TAB;
  }, [searchParams, tabs]);

  const tabMeta = useMemo(() => {
    switch (activeTab) {
      case "focus":
        return { label: "Focus", href: "/dashboard?tab=focus", icon: "Sun" };
      case "overview":
        return { label: "Dashboard", href: "/dashboard?tab=overview", icon: "LayoutDashboard" };
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
      default:
        return { label: "Focus", href: "/dashboard", icon: "Sun" };
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
        {activeTab === "focus" && (
          <div className="space-y-6">
            <FocusContent />
            {/* Reply windows, cooling leads and the activity numbers —
                the Today signals Focus has no gist card for. */}
            <TodayPage embedded />
          </div>
        )}
        {activeTab === "overview" && <DashboardContent />}
        {activeTab === "radar" && <MatchRadarPage />}
        {activeTab === "pulse" && <PulsePage />}
        {activeTab === "reengagement" && <ReengagementContent />}
        {activeTab === "market" && <MarketContent />}
        {activeTab === "team" && <TeamAnalyticsContent />}
      </div>
    </div>
  );
}
