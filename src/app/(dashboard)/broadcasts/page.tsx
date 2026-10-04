'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { pushUrl } from '@/lib/navigation';
import { useMemo, type KeyboardEvent } from 'react';
import BroadcastsContent from './broadcasts-content';
import TemplatePerformanceContent from './template-performance-content';
import VoiceCampaignsContent from './voice-campaigns-content';
import AnnouncementsContent from './announcements-content';
import CallAnalyticsContent from './call-analytics-content';
import GreetingsContent from './greetings-content';
import { FavoriteButton } from '@/components/layout/favorite-button';

type TabId =
  'campaigns' | 'templates' | 'voice' | 'calls' | 'announcements' | 'greetings';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'campaigns', label: 'Campaigns', icon: 'Radio' },
  { id: 'templates', label: 'Template Performance', icon: 'FileBarChart' },
  { id: 'voice', label: 'Voice Calls', icon: 'PhoneCall' },
  { id: 'calls', label: 'Call Analytics', icon: 'PhoneOutgoing' },
  { id: 'announcements', label: 'Announcements', icon: 'Mic' },
  { id: 'greetings', label: 'Greetings', icon: 'PartyPopper' },
];

export default function BroadcastsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const activeTab = useMemo(() => {
    const tab = searchParams.get('tab') as TabId;
    return TABS.some((t) => t.id === tab) ? tab : 'campaigns';
  }, [searchParams]);

  const tabMeta = useMemo(() => {
    const tab = TABS.find((t) => t.id === activeTab) ?? TABS[0];
    return {
      label: tab.label,
      href:
        tab.id === 'campaigns' ? '/broadcasts' : `/broadcasts?tab=${tab.id}`,
      icon: tab.icon,
    };
  }, [activeTab]);

  const handleTabChange = (tab: TabId) => {
    pushUrl(router, `/broadcasts?tab=${tab}`);
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
      {/* Header */}
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div>
          <h1 className="bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent text-white">
            Broadcasts
          </h1>
          <p className="mt-1.5 text-xs leading-relaxed font-medium text-slate-400 sm:text-sm">
            Send bulk messages using approved templates and track how each
            template performs.
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
        aria-label="Broadcast sections"
        onKeyDown={handleTabKeyDown}
        className="relative z-10 flex flex-nowrap gap-2 overflow-x-auto border-b border-slate-800/80"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => handleTabChange(tab.id)}
            className={`shrink-0 cursor-pointer border-b-2 px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-all ${
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
        {activeTab === 'campaigns' && <BroadcastsContent />}
        {activeTab === 'templates' && <TemplatePerformanceContent />}
        {activeTab === 'voice' && <VoiceCampaignsContent />}
        {activeTab === 'calls' && <CallAnalyticsContent />}
        {activeTab === 'announcements' && <AnnouncementsContent />}
        {activeTab === 'greetings' && <GreetingsContent />}
      </div>
    </div>
  );
}
