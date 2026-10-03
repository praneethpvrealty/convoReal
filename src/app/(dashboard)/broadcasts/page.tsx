'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { pushUrl } from '@/lib/navigation';
import { useMemo } from 'react';
import BroadcastsContent from './broadcasts-content';
import TemplatePerformanceContent from './template-performance-content';
import VoiceCampaignsContent from './voice-campaigns-content';
import AnnouncementsContent from './announcements-content';
import CallAnalyticsContent from './call-analytics-content';
import GreetingsContent from './greetings-content';
import { FavoriteButton } from '@/components/layout/favorite-button';

type TabId =
  'campaigns' | 'templates' | 'voice' | 'calls' | 'announcements' | 'greetings';

const TABS: { id: TabId; label: string }[] = [
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'templates', label: 'Templates' },
  { id: 'voice', label: 'Voice Calls' },
  { id: 'calls', label: 'Call Analytics' },
  { id: 'announcements', label: 'Announcements' },
  { id: 'greetings', label: 'Greetings' },
];

export default function BroadcastsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const activeTab = useMemo(() => {
    const tab = searchParams.get('tab') as TabId;
    return TABS.some((t) => t.id === tab) ? tab : 'campaigns';
  }, [searchParams]);

  const tabMeta = useMemo(() => {
    switch (activeTab) {
      case 'templates':
        return {
          label: 'Template Performance',
          href: '/broadcasts?tab=templates',
          icon: 'FileBarChart',
        };
      case 'voice':
        return {
          label: 'Voice Campaigns',
          href: '/broadcasts?tab=voice',
          icon: 'PhoneCall',
        };
      case 'calls':
        return {
          label: 'Call Analytics',
          href: '/broadcasts?tab=calls',
          icon: 'PhoneOutgoing',
        };
      case 'announcements':
        return {
          label: 'Announcements',
          href: '/broadcasts?tab=announcements',
          icon: 'Mic',
        };
      case 'greetings':
        return {
          label: 'Greetings',
          href: '/broadcasts?tab=greetings',
          icon: 'PartyPopper',
        };
      case 'campaigns':
      default:
        return { label: 'Broadcasts', href: '/broadcasts', icon: 'Radio' };
    }
  }, [activeTab]);

  const handleTabChange = (tab: TabId) => {
    pushUrl(router, `/broadcasts?tab=${tab}`);
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
