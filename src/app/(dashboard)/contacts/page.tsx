'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { pushUrl } from '@/lib/navigation';
import { useMemo } from 'react';
import ContactsContent from './contacts-content';
import RequirementsPage from '../requirements/requirements-content';
import AgentsPage from '../agents/agents-content';
import SourcesContent from './sources-content';

type TabId = 'list' | 'requirements' | 'agents' | 'sources';

const TABS: { id: TabId; label: string }[] = [
  { id: 'list', label: 'Contacts List' },
  { id: 'requirements', label: 'Requirements' },
  { id: 'agents', label: 'Agents' },
  { id: 'sources', label: 'Sources' },
];

export default function ContactsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const activeTab = useMemo(() => {
    const tab = searchParams.get('tab') as TabId;
    return TABS.some((t) => t.id === tab) ? tab : 'list';
  }, [searchParams]);

  const handleTabChange = (tab: TabId) => {
    pushUrl(router, `/contacts?tab=${tab}`);
  };

  return (
    <div className="relative space-y-6 overflow-hidden">
      <div
        className="relative z-10 flex gap-2 border-b border-slate-800/80"
        title="Manage buyers, assign agents, verify leads, and track stated requirements."
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            data-tour={`contacts-tab-${tab.id}`}
            onClick={() => handleTabChange(tab.id)}
            className={`cursor-pointer border-b-2 px-4 py-2.5 text-sm font-semibold transition-all ${
              activeTab === tab.id
                ? 'border-primary bg-primary/5 text-white'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Render Active View */}
      <div className="relative z-10">
        {activeTab === 'list' && <ContactsContent />}
        {activeTab === 'requirements' && <RequirementsPage />}
        {activeTab === 'agents' && <AgentsPage />}
        {activeTab === 'sources' && <SourcesContent />}
      </div>
    </div>
  );
}
