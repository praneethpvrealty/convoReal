'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { pushUrl } from '@/lib/navigation';
import { useEffect, useMemo, type KeyboardEvent } from 'react';
import { legacyPipelinesHref } from '@/lib/deals/routes';
import FlowsPage from '../flows/flows-content';
import AutomationAnalyticsContent from './analytics-content';
import AutomationsListContent from './automations-list-content';
import { FavoriteButton } from '@/components/layout/favorite-button';

type TabId = 'automations' | 'flows' | 'analytics';

const TABS: { id: TabId; label: string }[] = [
  { id: 'automations', label: 'Automations' },
  { id: 'flows', label: 'Flows' },
  { id: 'analytics', label: 'Analytics' },
];

export default function AutomationsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const requestedTab = searchParams.get('tab');
  const activeTab = useMemo(() => {
    const tab = requestedTab as TabId;
    return TABS.some((t) => t.id === tab) ? tab : 'automations';
  }, [requestedTab]);

  useEffect(() => {
    if (requestedTab === 'pipelines') {
      router.replace(legacyPipelinesHref(new URLSearchParams(searchParams)));
    }
  }, [requestedTab, router, searchParams]);

  const tabMeta = useMemo(() => {
    switch (activeTab) {
      case 'analytics':
        return {
          label: 'Automation Analytics',
          href: '/automations?tab=analytics',
          icon: 'ChartColumn',
        };
      case 'flows':
        return {
          label: 'Flows',
          href: '/automations?tab=flows',
          icon: 'Workflow',
        };
      default:
        return {
          label: 'Automations',
          href: '/automations',
          icon: 'GitBranch',
        };
    }
  }, [activeTab]);

  const handleTabChange = (tab: TabId) => {
    pushUrl(router, `/automations?tab=${tab}`);
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const current = TABS.findIndex((t) => t.id === activeTab);
    const next = (current + step + TABS.length) % TABS.length;
    handleTabChange(TABS[next].id);
    event.currentTarget
      .querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  };

  return (
    <div className="relative space-y-6 overflow-hidden">
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div>
          <h1 className="bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent text-white">
            Automations
          </h1>
          <p className="mt-1.5 text-xs leading-relaxed font-medium text-slate-400 sm:text-sm">
            Configure automated workflows and interactive WhatsApp flows.
          </p>
        </div>
        <FavoriteButton
          label={tabMeta.label}
          href={tabMeta.href}
          icon={tabMeta.icon}
        />
      </div>

      <div
        role="tablist"
        aria-label="Automation sections"
        onKeyDown={handleTabKeyDown}
        className="relative z-10 flex gap-2 overflow-x-auto border-b border-slate-800/80"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => handleTabChange(tab.id)}
            className={`shrink-0 cursor-pointer border-b-2 px-4 py-2.5 text-sm font-semibold transition-all ${
              activeTab === tab.id
                ? 'border-primary bg-primary/5 text-white'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="relative z-10">
        {activeTab === 'automations' && <AutomationsListContent />}
        {activeTab === 'flows' && <FlowsPage />}
        {activeTab === 'analytics' && <AutomationAnalyticsContent />}
      </div>
    </div>
  );
}
