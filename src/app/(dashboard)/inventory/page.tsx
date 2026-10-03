'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { pushUrl } from '@/lib/navigation';
import { useEffect, useMemo } from 'react';
import InventoryContent from './inventory-content';
import ProjectsContent from './projects-content';
import { FavoriteButton } from '@/components/layout/favorite-button';

type TabId = 'list' | 'projects';

export default function InventoryPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const tabs = useMemo(
    () => [
      { id: 'list' as TabId, label: 'Inventory List' },
      { id: 'projects' as TabId, label: 'Projects' },
    ],
    []
  );

  const legacyAdsTab = searchParams.get('tab') === 'ads';

  useEffect(() => {
    if (legacyAdsTab) router.replace('/ads');
  }, [legacyAdsTab, router]);

  const activeTab = useMemo(() => {
    const tab = searchParams.get('tab') as TabId;
    return tabs.some((t) => t.id === tab) ? tab : 'list';
  }, [searchParams, tabs]);

  const tabMeta = useMemo(() => {
    switch (activeTab) {
      case 'projects':
        return {
          label: 'Projects',
          href: '/inventory?tab=projects',
          icon: 'Building2',
        };
      case 'list':
      default:
        return { label: 'Inventory', href: '/inventory', icon: 'Home' };
    }
  }, [activeTab]);

  const handleTabChange = (tab: TabId) => {
    pushUrl(router, `/inventory?tab=${tab}`);
  };

  return (
    <div className="relative space-y-6 overflow-hidden">
      {/* Header */}
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div>
          <h1 className="bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent text-white">
            Inventory
          </h1>
          <p className="mt-1.5 text-xs leading-relaxed font-medium text-slate-400 sm:text-sm">
            Manage listings, create flyers and track approvals.
          </p>
        </div>
        <FavoriteButton
          label={tabMeta.label}
          href={tabMeta.href}
          icon={tabMeta.icon}
        />
      </div>

      {/* Sleek Tab Bar */}
      {tabs.length > 1 && (
        <div className="relative z-10 flex gap-2 border-b border-slate-800/80">
          {tabs.map((tab) => (
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
      )}

      {/* Render Active View */}
      <div className="relative z-10">
        {activeTab === 'list' && <InventoryContent />}
        {activeTab === 'projects' && <ProjectsContent />}
      </div>
    </div>
  );
}
