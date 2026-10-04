'use client';

import {
  useCallback,
  useMemo,
  useSyncExternalStore,
  createElement,
} from 'react';
import type { Deal, PipelineStage } from '@/types';
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  Info,
  Trophy,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { getCurrencyIcon } from '@/lib/currency-utils';
import { dealFee, formatDealAmount } from '@/lib/pipelines/deal-money';
import { readStored, writeStored } from '@/lib/safe-storage';

interface PipelineAnalyticsProps {
  stages: PipelineStage[];
  deals: Deal[];
  scopeLabel: string;
  currency?: string;
}

/**
 * Weighted pipeline value: value × per-stage probability.
 * First stage ≈ 10%, stages interpolate up to 90% before the final stage,
 * final stage (Won) = 100%. Lost deals excluded.
 */
function computeStageProbability(
  stage: PipelineStage,
  sortedStages: PipelineStage[]
): number {
  const n = sortedStages.length;
  if (n <= 1) return 1;
  const index = sortedStages.findIndex((s) => s.id === stage.id);
  if (index < 0) return 0;
  if (index === n - 1) return 1;
  const slots = n - 1;
  if (slots <= 1) return 0.1;
  const t = index / (slots - 1);
  return 0.1 + t * (0.9 - 0.1);
}

export const KPI_EXPANDED_STORAGE_KEY = 'convoreal:deals-kpi-expanded';

const kpiListeners = new Set<() => void>();

function subscribeKpiExpanded(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === KPI_EXPANDED_STORAGE_KEY) {
      onChange();
    }
  };
  kpiListeners.add(onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    kpiListeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

let unstoredKpiExpanded: boolean | null = null;

function getKpiExpandedSnapshot(): boolean {
  const stored = readStored(KPI_EXPANDED_STORAGE_KEY);
  if (stored === null) return unstoredKpiExpanded ?? false;
  return stored === '1';
}

function getKpiExpandedServerSnapshot(): boolean {
  return false;
}

function useKpiExpanded(): [boolean, (next: boolean) => void] {
  const expanded = useSyncExternalStore(
    subscribeKpiExpanded,
    getKpiExpandedSnapshot,
    getKpiExpandedServerSnapshot
  );
  const setExpanded = useCallback((next: boolean) => {
    unstoredKpiExpanded = writeStored(
      KPI_EXPANDED_STORAGE_KEY,
      next ? '1' : '0'
    )
      ? null
      : next;
    kpiListeners.forEach((listener) => listener());
  }, []);
  return [expanded, setExpanded];
}

export function PipelineAnalytics({
  stages,
  deals,
  scopeLabel,
  currency = 'INR',
}: PipelineAnalyticsProps) {
  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages]
  );

  const stats = useMemo(() => {
    const active = deals.filter((d) => d.status !== 'lost');
    const openDeals = active.filter((d) => d.status !== 'won');

    const totalCount = deals.length;
    let totalValue = 0;
    let feeCount = 0;
    for (const d of active) {
      const fee = dealFee(d);
      if (fee === null) continue;
      totalValue += fee;
      feeCount += 1;
    }
    const avgValue = feeCount > 0 ? totalValue / feeCount : 0;

    const stageById = new Map(sortedStages.map((s) => [s.id, s]));
    const weightedValue = openDeals.reduce((sum, d) => {
      const stage = stageById.get(d.stage_id);
      if (!stage) return sum;
      const prob = computeStageProbability(stage, sortedStages);
      return sum + (dealFee(d) ?? 0) * prob;
    }, 0);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonth = (d: Deal) => {
      const ts = d.updated_at ?? d.created_at;
      return ts ? new Date(ts) >= monthStart : false;
    };
    const wonThisMonth = deals.filter(
      (d) => d.status === 'won' && thisMonth(d)
    ).length;
    const lostThisMonth = deals.filter(
      (d) => d.status === 'lost' && thisMonth(d)
    ).length;

    return {
      totalCount,
      totalValue,
      avgValue,
      weightedValue,
      wonThisMonth,
      lostThisMonth,
    };
  }, [deals, sortedStages]);

  const [expanded, setExpanded] = useKpiExpanded();

  return (
    <TooltipProvider>
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:grid-cols-4">
        <Metric
          icon={createElement(getCurrencyIcon(currency), {
            className: 'h-4 w-4 text-primary',
          })}
          label="Pipeline value"
          value={formatDealAmount(stats.totalValue, currency)}
          tooltip="Brokerage recorded on active deals. A deal with no brokerage recorded counts as nothing until it is set."
        />
        <Metric
          icon={createElement(getCurrencyIcon(currency), {
            className: 'h-4 w-4 text-purple-400',
          })}
          label="Weighted revenue"
          value={formatDealAmount(stats.weightedValue, currency)}
          tooltip="Expected brokerage revenue: each open deal's recorded brokerage × its stage probability. First stage ≈ 10%, stages progress up to 90%, Won = 100%. Lost deals, and deals with no brokerage recorded, add nothing."
        />
        <Metric
          icon={<Trophy className="text-primary h-4 w-4" />}
          label="Won this month"
          value={String(stats.wonThisMonth)}
          tooltip="Deals marked as Won since the first day of the current month."
        />
        {expanded ? (
          <>
            <Metric
              icon={<BarChart3 className="h-4 w-4 text-slate-400" />}
              label="Deals shown"
              value={String(stats.totalCount)}
              tooltip={`Every deal the Focus/All switch is showing (${scopeLabel}), lost deals included, so it matches the switch's count.`}
            />
            <Metric
              icon={createElement(getCurrencyIcon(currency), {
                className: 'h-4 w-4 text-blue-400',
              })}
              label="Avg brokerage"
              value={formatDealAmount(stats.avgValue, currency)}
              tooltip="Pipeline value divided by the active deals that have brokerage recorded. Deals with no brokerage recorded are left out of the average."
            />
            <Metric
              icon={<XCircle className="h-4 w-4 text-red-400" />}
              label="Lost this month"
              value={String(stats.lostThisMonth)}
              tooltip="Deals marked as Lost since the first day of the current month."
            />
          </>
        ) : null}
        <div className="flex items-center justify-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            className="text-slate-400 hover:text-white"
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
            {expanded ? 'Less' : 'More'}
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}

function Metric({
  icon,
  label,
  value,
  tooltip,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tooltip: string;
}) {
  return (
    <div className="rounded-lg bg-slate-800/50 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium tracking-wider text-slate-400 uppercase">
        {icon}
        <span>{label}</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`How ${label} is calculated`}
                className="ml-auto text-slate-500 hover:text-slate-300 focus:outline-none"
              />
            }
          >
            <Info className="h-3 w-3" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-left">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      </div>
      <p className="mt-1 text-base font-semibold text-white">{value}</p>
    </div>
  );
}
