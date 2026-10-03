'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { pushUrl } from '@/lib/navigation';
import { useEffect, useMemo } from 'react';
import { legacyPipelinesHref } from '@/lib/deals/routes';
import FlowsPage from '../flows/flows-content';
import AutomationAnalyticsContent from './analytics-content';
import { FavoriteButton } from '@/components/layout/favorite-button';

type TabId = 'flows' | 'analytics';

const TABS: { id: TabId; label: string }[] = [
  { id: 'flows', label: 'Flows' },
  { id: 'analytics', label: 'Analytics' },
];

export default function AutomationsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const requestedTab = searchParams.get('tab');
  const activeTab = useMemo(() => {
    const tab = requestedTab as TabId;
    return TABS.some((t) => t.id === tab) ? tab : 'flows';
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
      default:
        return {
          label: 'Flows',
          href: '/automations?tab=flows',
          icon: 'Workflow',
        };
    }
  }, [activeTab]);

  const handleTabChange = (tab: TabId) => {
    pushUrl(router, `/automations?tab=${tab}`);
  };

  return (
    <div className="relative space-y-6 overflow-hidden">
      {/* Header */}
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div>
          <h1 className="bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent text-white">
            Automations
          </h1>
          <p className="mt-1.5 text-xs leading-relaxed font-medium text-slate-400 sm:text-sm">
            Configure automated workflows and interactive WhatsApp flows. The
            deal board now lives under Deals.
          </p>
        </div>
        <FavoriteButton
          label={tabMeta.label}
          href={tabMeta.href}
          icon={tabMeta.icon}
        />
      </div>

      {/* Sleek Tab Bar */}
      <div className="relative z-10 flex gap-2 border-b border-slate-800/80">
        {TABS.map((tab) => (
          <button
            key={tab.id}
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
        {activeTab === 'flows' && <FlowsPage />}
        {activeTab === 'analytics' && <AutomationAnalyticsContent />}
      </div>
    </div>
  );
}
