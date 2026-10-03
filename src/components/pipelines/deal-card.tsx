'use client';

import type { Deal, PipelineStage } from '@/types';
import { Calendar, Check, X } from 'lucide-react';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
import { isBrokeragePaidStage } from '@/lib/pipelines/stage-semantics';
import { lostReasonLabel } from '@/lib/pipelines/lost-reasons';
import {
  dealCardCopy,
  dealFee,
  dealFeeLabel,
  formatDealAmount,
} from '@/lib/pipelines/deal-money';
import { cn } from '@/lib/utils';

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || '?').trim();
  if (!source) return '?';
  return source.charAt(0).toUpperCase();
}

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  isOverlay?: boolean;
  currency?: string;
}

export function DealCard({
  deal,
  stage,
  onEdit,
  isOverlay,
  currency,
}: DealCardProps) {
  const contactLabel =
    deal.contact?.name || deal.contact?.phone || 'No contact';
  const assigneeLabel = deal.assignee?.full_name || null;
  const brokeragePaid = stage ? isBrokeragePaidStage(stage) : false;
  const { headline, subline } = dealCardCopy(deal);
  const dealCurrency = deal.currency || currency;
  const feeSet = dealFee(deal) !== null;

  return (
    <button
      type="button"
      onClick={(e) => {
        // `onClick` still fires after a non-drag tap because the PointerSensor
        // requires 5px movement before it counts as a drag.
        if (isOverlay) return;
        e.stopPropagation();
        onEdit(deal);
      }}
      className={`group relative w-full cursor-pointer rounded-xl border border-slate-700/50 bg-slate-800/70 py-3 pr-3 pl-4 text-left shadow-sm transition-all ${
        isOverlay
          ? 'shadow-xl'
          : 'hover:-translate-y-0.5 hover:border-slate-600 hover:bg-slate-800 hover:shadow-lg'
      }`}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute top-0 left-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? '#94a3b8' }}
      />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="line-clamp-2 text-sm leading-snug font-semibold break-words text-white">
            {headline}
          </h4>
          {subline && (
            <p className="mt-0.5 line-clamp-2 text-xs break-words text-slate-400">
              {subline}
            </p>
          )}
        </div>
        {deal.status === 'won' && (
          <span className="bg-primary/15 text-primary inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold">
            <Check className="h-3 w-3" />
            Won
          </span>
        )}
        {deal.status === 'lost' && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
            <X className="h-3 w-3" />
            Lost
          </span>
        )}
      </div>

      {/* Contact row */}
      <div className="mt-2 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-[11px] font-semibold text-slate-200">
          {initials(deal.contact?.name, deal.contact?.phone ?? undefined)}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-xs text-slate-400">
          <span className="truncate">{contactLabel}</span>
          <NameTagBadge tag={deal.contact?.name_tag} />
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-primary text-sm font-bold">
            {formatDealAmount(deal.value, dealCurrency)}
          </span>
          <span
            className={cn(
              'text-[11px] font-medium',
              feeSet ? 'text-slate-400' : 'text-slate-500'
            )}
          >
            {dealFeeLabel(deal, {
              paid: brokeragePaid,
              currency: dealCurrency,
            })}
          </span>
        </div>
        {deal.expected_close_date && (
          <span className="flex items-center gap-1 text-[11px] text-slate-500">
            <Calendar className="h-3 w-3" />
            {formatDate(deal.expected_close_date)}
          </span>
        )}
      </div>

      {deal.status === 'lost' && lostReasonLabel(deal) && (
        <p className="mt-1.5 line-clamp-2 text-[11px] text-red-300/80">
          {lostReasonLabel(deal)}
        </p>
      )}

      {brokeragePaid && deal.brokerage_paid_at && (
        <p className="mt-1 text-[11px] text-slate-500">
          Paid {formatDate(deal.brokerage_paid_at)}
        </p>
      )}

      {assigneeLabel && (
        <div className="mt-2 flex items-center justify-end">
          <span
            title={assigneeLabel}
            className="bg-primary/15 text-primary flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold"
          >
            {initials(assigneeLabel)}
          </span>
        </div>
      )}
    </button>
  );
}
