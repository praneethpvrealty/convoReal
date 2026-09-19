'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Briefcase } from 'lucide-react';

import { TransactionWorkspaceIndex } from '@/components/deals/transaction-workspace-index';
import { FavoriteButton } from '@/components/layout/favorite-button';
import { DEALS_VIEWS, dealsHref, parseDealsView } from '@/lib/deals/routes';
import { pushUrl } from '@/lib/navigation';
import { cn } from '@/lib/utils';

import JourneyContent from '../journey/journey-content';
import PipelinesContent from '../pipelines/pipelines-content';

export default function DealsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const view = parseDealsView(searchParams.get('view'));
  const current = DEALS_VIEWS.find((v) => v.id === view) ?? DEALS_VIEWS[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-3xl font-extrabold tracking-tight">
            <Briefcase className="text-primary h-7 w-7" />
            <span className="bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
              Deals
            </span>
            <FavoriteButton
              label={`Deals · ${current.label}`}
              href={dealsHref(view)}
              icon="Briefcase"
            />
          </h1>
          <p className="mt-1 text-sm text-slate-400">{current.lede}</p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-slate-800/80">
        {DEALS_VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => pushUrl(router, dealsHref(item.id))}
            className={cn(
              'cursor-pointer border-b-2 px-4 py-2.5 text-sm font-semibold transition-all',
              view === item.id
                ? 'border-primary bg-primary/5 text-white'
                : 'border-transparent text-slate-400 hover:text-white'
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {view === 'board' && <PipelinesContent />}
      {view === 'journey' && <JourneyContent embedded />}
      {view === 'records' && <TransactionWorkspaceIndex embedded />}
    </div>
  );
}
