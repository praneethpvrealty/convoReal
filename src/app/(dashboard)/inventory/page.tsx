"use client"

import { useSearchParams, useRouter } from "next/navigation";
import { pushUrl } from "@/lib/navigation";
import { useMemo } from "react";
import InventoryContent from "./inventory-content";
import AdsPage from "../ads/ads-content";
import { FavoriteButton } from "@/components/layout/favorite-button";

const META_ADS_ENABLED = !!process.env.NEXT_PUBLIC_META_ADS_APP_ID;

type TabId = "list" | "ads";

export default function InventoryPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const tabs = useMemo(() => {
    const list = [{ id: "list" as TabId, label: "Inventory List" }];
    if (META_ADS_ENABLED) {
      list.push({ id: "ads" as TabId, label: "Ads Campaigns" });
    }
    return list;
  }, []);

  const activeTab = useMemo(() => {
    const tab = searchParams.get("tab") as TabId;
    return tabs.some((t) => t.id === tab) ? tab : "list";
  }, [searchParams, tabs]);

  const tabMeta = useMemo(() => {
    switch (activeTab) {
      case "ads":
        return { label: "Ads", href: "/inventory?tab=ads", icon: "Megaphone" };
      case "list":
      default:
        return { label: "Inventory", href: "/inventory", icon: "Home" };
    }
  }, [activeTab]);

  const handleTabChange = (tab: TabId) => {
    pushUrl(router, `/inventory?tab=${tab}`);
  };

  return (
    <div className="space-y-6 relative overflow-hidden">
      {/* Header */}
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
            Inventory
          </h1>
          <p className="mt-1.5 text-xs sm:text-sm text-slate-400 font-medium leading-relaxed">
            Manage listings, create flyers, track approvals, and run ad campaigns.
          </p>
        </div>
        <FavoriteButton label={tabMeta.label} href={tabMeta.href} icon={tabMeta.icon} />
      </div>

      {/* Sleek Tab Bar */}
      {tabs.length > 1 && (
        <div className="flex border-b border-slate-800/80 gap-2 relative z-10">
          {tabs.map((tab) => (
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
      )}

      {/* Render Active View */}
      <div className="relative z-10">
        {activeTab === "list" && <InventoryContent />}
        {activeTab === "ads" && <AdsPage />}
      </div>
    </div>
  );
}
