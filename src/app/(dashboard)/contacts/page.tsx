"use client"

import { useSearchParams, useRouter } from "next/navigation";
import { pushUrl } from "@/lib/navigation";
import { useMemo } from "react";
import ContactsContent from "./contacts-content";
import RequirementsPage from "../requirements/requirements-content";
import AgentsPage from "../agents/agents-content";
import SourcesContent from "./sources-content";

type TabId = "list" | "requirements" | "agents" | "sources";

const TABS: { id: TabId; label: string }[] = [
  { id: "list", label: "Contacts List" },
  { id: "requirements", label: "Requirements" },
  { id: "agents", label: "Agents" },
  { id: "sources", label: "Sources" },
];

export default function ContactsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const activeTab = useMemo(() => {
    const tab = searchParams.get("tab") as TabId;
    return TABS.some((t) => t.id === tab) ? tab : "list";
  }, [searchParams]);

  const handleTabChange = (tab: TabId) => {
    pushUrl(router, `/contacts?tab=${tab}`);
  };

  return (
    <div className="space-y-6 relative overflow-hidden">
      {/* Header — no page-level Favorite button: Contacts is already a
          main sidebar entry, so pinning it there is a no-op for the user. */}
      <div className="relative z-10">
        <h1 className="text-3xl font-extrabold text-white tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
          Contacts
        </h1>
        <p className="mt-1.5 text-xs sm:text-sm text-slate-400 font-medium leading-relaxed">
          Manage buyers, assign agents, verify leads, and track stated requirements.
        </p>
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
        {activeTab === "sources" && <SourcesContent />}
      </div>
    </div>
  );
}
