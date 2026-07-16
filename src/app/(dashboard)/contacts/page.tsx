"use client"

import { useSearchParams, useRouter } from "next/navigation";
import { useMemo } from "react";
import ContactsContent from "./contacts-content";
import RequirementsPage from "../requirements/requirements-content";
import AgentsPage from "../agents/agents-content";
import { FavoriteButton } from "@/components/layout/favorite-button";

type TabId = "list" | "requirements" | "agents";

const TABS: { id: TabId; label: string }[] = [
  { id: "list", label: "Contacts List" },
  { id: "requirements", label: "Requirements" },
  { id: "agents", label: "Agents" },
];

/** Mirrors the quick-filter tabs in contacts-content.tsx (All Contacts is
 *  the default and has no `filter` param). Used so the page-level
 *  Favorite button captures the exact filtered view — e.g. "Needs
 *  Review" — instead of always favoriting the unfiltered list. */
const QUICK_FILTER_LABELS: Record<string, string> = {
  pending_review: "Needs Review",
  transacted: "Transacted",
  market_active: "Active Buyers",
};

export default function ContactsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const activeTab = useMemo(() => {
    const tab = searchParams.get("tab") as TabId;
    return TABS.some((t) => t.id === tab) ? tab : "list";
  }, [searchParams]);

  const quickFilter = searchParams.get("filter");

  const tabMeta = useMemo(() => {
    switch (activeTab) {
      case "requirements":
        return { label: "Requirements", href: "/contacts?tab=requirements", icon: "ClipboardList" };
      case "agents":
        return { label: "Agents", href: "/contacts?tab=agents", icon: "UsersRound" };
      case "list":
      default: {
        const filterLabel = quickFilter ? QUICK_FILTER_LABELS[quickFilter] : undefined;
        return {
          label: filterLabel ? `Contacts — ${filterLabel}` : "Contacts",
          href: quickFilter ? `/contacts?filter=${quickFilter}` : "/contacts",
          icon: "Users",
        };
      }
    }
  }, [activeTab, quickFilter]);

  const handleTabChange = (tab: TabId) => {
    router.push(`/contacts?tab=${tab}`, { scroll: false });
  };

  return (
    <div className="space-y-6 relative overflow-hidden">
      {/* Header */}
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
            Contacts
          </h1>
          <p className="mt-1.5 text-xs sm:text-sm text-slate-400 font-medium leading-relaxed">
            Manage buyers, assign agents, verify leads, and track stated requirements.
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
        {activeTab === "list" && <ContactsContent />}
        {activeTab === "requirements" && <RequirementsPage />}
        {activeTab === "agents" && <AgentsPage />}
      </div>
    </div>
  );
}
