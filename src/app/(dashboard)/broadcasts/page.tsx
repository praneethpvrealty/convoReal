"use client"

import { useSearchParams, useRouter } from "next/navigation";
import { pushUrl } from "@/lib/navigation";
import { useMemo } from "react";
import BroadcastsContent from "./broadcasts-content";
import TemplatePerformanceContent from "./template-performance-content";
import VoiceCampaignsContent from "./voice-campaigns-content";
import AnnouncementsContent from "./announcements-content";
import CallAnalyticsContent from "./call-analytics-content";
import { FavoriteButton } from "@/components/layout/favorite-button";

type TabId = "campaigns" | "templates" | "voice" | "calls" | "announcements";

const TABS: { id: TabId; label: string }[] = [
  { id: "campaigns", label: "Campaigns" },
  { id: "templates", label: "Templates" },
  { id: "voice", label: "Voice Calls" },
  { id: "calls", label: "Call Analytics" },
  { id: "announcements", label: "Announcements" },
];

export default function BroadcastsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const activeTab = useMemo(() => {
    const tab = searchParams.get("tab") as TabId;
    return TABS.some((t) => t.id === tab) ? tab : "campaigns";
  }, [searchParams]);

  const tabMeta = useMemo(() => {
    switch (activeTab) {
      case "templates":
        return { label: "Template Performance", href: "/broadcasts?tab=templates", icon: "FileBarChart" };
      case "voice":
        return { label: "Voice Campaigns", href: "/broadcasts?tab=voice", icon: "PhoneCall" };
      case "calls":
        return { label: "Call Analytics", href: "/broadcasts?tab=calls", icon: "PhoneOutgoing" };
      case "announcements":
        return { label: "Announcements", href: "/broadcasts?tab=announcements", icon: "Mic" };
      case "campaigns":
      default:
        return { label: "Broadcasts", href: "/broadcasts", icon: "Radio" };
    }
  }, [activeTab]);

  const handleTabChange = (tab: TabId) => {
    pushUrl(router, `/broadcasts?tab=${tab}`);
  };

  return (
    <div className="space-y-6 relative overflow-hidden">
      {/* Header */}
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
            Broadcasts
          </h1>
          <p className="mt-1.5 text-xs sm:text-sm text-slate-400 font-medium leading-relaxed">
            Send bulk messages using approved templates and track how each template performs.
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
        {activeTab === "campaigns" && <BroadcastsContent />}
        {activeTab === "templates" && <TemplatePerformanceContent />}
        {activeTab === "voice" && <VoiceCampaignsContent />}
        {activeTab === "calls" && <CallAnalyticsContent />}
        {activeTab === "announcements" && <AnnouncementsContent />}
      </div>
    </div>
  );
}
