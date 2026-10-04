'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { pushUrl } from '@/lib/navigation';
import { useEffect, useMemo, type KeyboardEvent } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useDashboardTabCounts } from '@/lib/dashboard/tab-counts';
import DashboardContent from './dashboard-content';
import FocusContent from './focus-content';
import TodayPage from '../today/today-content';
import MatchRadarPage from '../radar/radar-content';
import PulsePage from '../pulse/pulse-content';
import GapsContent from '../gaps/gaps-content';
import ReengagementContent from '../reengagement/reengagement-content';
import TeamAnalyticsContent from './team-analytics-content';
import MarketContent from './market-content';
import { FavoriteButton } from '@/components/layout/favorite-button';

type TabId =
  | 'focus'
  | 'overview'
  | 'radar'
  | 'pulse'
  | 'gaps'
  | 'reengagement'
  | 'market'
  | 'team';

// Focus leads and is where an unqualified /dashboard lands: it answers
// "what do I do next?", which is the question an agent opens the app
// with. Overview answers "how are we doing?" — a question you go
// looking for. Focus replaced the Today tab and absorbed its agenda;
// Today's remaining signals render underneath it.
const BASE_TABS: { id: TabId; label: string }[] = [
  { id: 'focus', label: 'Focus' },
  { id: 'overview', label: 'Overview' },
  { id: 'radar', label: 'Match Radar' },
  { id: 'pulse', label: 'Pulse' },
  { id: 'gaps', label: 'Gaps' },
  { id: 'reengagement', label: 'Re-engagement' },
  { id: 'market', label: 'Market' },
];

const DEFAULT_TAB: TabId = 'focus';

export default function DashboardPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isOrgManager, isOrgLeader, canSendMessages, accountId } = useAuth();
  const tabCounts = useDashboardTabCounts(accountId);

  useEffect(() => {
    if (accountId && canSendMessages) {
      void fetch('/api/agents/inventory-sync', { method: 'POST' });
    }
  }, [accountId, canSendMessages]);

  const tabs = useMemo(
    () =>
      isOrgManager || isOrgLeader
        ? [...BASE_TABS, { id: 'team' as TabId, label: 'Team' }]
        : BASE_TABS,
    [isOrgManager, isOrgLeader]
  );

  const activeTab = useMemo(() => {
    const tab = searchParams.get('tab') as TabId;
    return tabs.some((t) => t.id === tab) ? tab : DEFAULT_TAB;
  }, [searchParams, tabs]);

  const tabMeta = useMemo(() => {
    switch (activeTab) {
      case 'focus':
        return { label: 'Focus', href: '/dashboard?tab=focus', icon: 'Sun' };
      case 'overview':
        return {
          label: 'Dashboard',
          href: '/dashboard?tab=overview',
          icon: 'LayoutDashboard',
        };
      case 'radar':
        return {
          label: 'Match Radar',
          href: '/dashboard?tab=radar',
          icon: 'Radar',
        };
      case 'pulse':
        return {
          label: 'Pulse',
          href: '/dashboard?tab=pulse',
          icon: 'Activity',
        };
      case 'gaps':
        return {
          label: 'Gaps',
          href: '/dashboard?tab=gaps',
          icon: 'AlertTriangle',
        };
      case 'reengagement':
        return {
          label: 'Re-engagement',
          href: '/dashboard?tab=reengagement',
          icon: 'Megaphone',
        };
      case 'market':
        return {
          label: 'Market',
          href: '/dashboard?tab=market',
          icon: 'MapPin',
        };
      case 'team':
        return { label: 'Team', href: '/dashboard?tab=team', icon: 'Users' };
      default:
        return { label: 'Focus', href: '/dashboard', icon: 'Sun' };
    }
  }, [activeTab]);

  const handleTabChange = (tab: TabId) => {
    pushUrl(router, `/dashboard?tab=${tab}`);
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const current = tabs.findIndex((t) => t.id === activeTab);
    const next = (current + step + tabs.length) % tabs.length;
    handleTabChange(tabs[next].id);
    event.currentTarget
      .querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  };

  return (
    <div className="relative space-y-6 overflow-hidden">
      <div className="relative z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-800/80">
        <h1 className="text-xl font-bold tracking-tight text-white">
          Dashboard
        </h1>
        <div
          role="tablist"
          aria-label="Dashboard sections"
          onKeyDown={handleTabKeyDown}
          className="order-last flex w-full flex-nowrap gap-2 overflow-x-auto md:order-none md:w-auto md:min-w-0 md:flex-1"
        >
          {tabs.map((tab) => {
            const count =
              tab.id === 'radar'
                ? tabCounts.radar
                : tab.id === 'gaps'
                  ? tabCounts.gaps
                  : 0;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => handleTabChange(tab.id)}
                data-tour={`dashboard-tab-${tab.id}`}
                className={`shrink-0 cursor-pointer border-b-2 px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-all ${
                  activeTab === tab.id
                    ? 'border-primary bg-primary/5 text-white'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
                {count > 0 && (
                  <span className="bg-primary/15 text-primary ml-2 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums">
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="ml-auto md:ml-0">
          <FavoriteButton
            label={tabMeta.label}
            href={tabMeta.href}
            icon={tabMeta.icon}
          />
        </div>
      </div>

      {/* Render Active View */}
      <div className="relative z-10">
        {activeTab === 'focus' && (
          <div className="space-y-6">
            <FocusContent />
            {/* Reply windows, cooling leads and the activity numbers —
                the Today signals Focus has no gist card for. */}
            <TodayPage embedded />
          </div>
        )}
        {activeTab === 'overview' && <DashboardContent />}
        {activeTab === 'radar' && <MatchRadarPage />}
        {activeTab === 'pulse' && <PulsePage />}
        {activeTab === 'gaps' && <GapsContent />}
        {activeTab === 'reengagement' && <ReengagementContent />}
        {activeTab === 'market' && <MarketContent />}
        {activeTab === 'team' && <TeamAnalyticsContent />}
      </div>
    </div>
  );
}
