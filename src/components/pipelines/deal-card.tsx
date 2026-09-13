'use client';

import type { Deal, PipelineStage } from '@/types';
import { Calendar, Check, X } from 'lucide-react';
import { formatCurrency } from '@/lib/currency-utils';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
import { isBrokeragePaidStage } from '@/lib/pipelines/stage-semantics';

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
  const brokeragePaid = stage ? isBrokeragePaidStage(stage.name) : false;

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
        <h4 className="flex-1 text-sm leading-snug font-semibold break-words text-white">
          {deal.title}
        </h4>
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
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-[10px] font-semibold text-slate-200">
          {initials(deal.contact?.name, deal.contact?.phone ?? undefined)}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-xs text-slate-400">
          <span className="truncate">{contactLabel}</span>
          <NameTagBadge tag={deal.contact?.name_tag} />
        </span>
      </div>

      {deal.property && (
        <div className="text-slate-450 mt-1.5 flex w-fit max-w-full items-center gap-1 rounded border border-slate-800/40 bg-slate-950/20 px-2 py-0.5 text-[11px]">
          <span className="shrink-0 text-[10px] saturate-50 filter">🏡</span>
          <span
            className="text-slate-350 truncate font-medium"
            title={deal.property.title}
          >
            {deal.property.title}
          </span>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-primary text-sm font-bold">
            {formatCurrency(deal.value, deal.currency || currency)}
          </span>
          <span className="text-[10px] font-medium text-slate-400">
            {brokeragePaid ? 'Brokerage received: ' : 'Fee: '}
            {formatCurrency(
              deal.brokerage_amount !== null &&
                deal.brokerage_amount !== undefined
                ? Number(deal.brokerage_amount)
                : Number(deal.value || 0) * 0.02,
              deal.currency || currency
            )}
          </span>
        </div>
        {deal.expected_close_date && (
          <span className="flex items-center gap-1 text-[11px] text-slate-500">
            <Calendar className="h-3 w-3" />
            {formatDate(deal.expected_close_date)}
          </span>
        )}
      </div>

      {brokeragePaid && deal.brokerage_paid_at && (
        <p className="mt-1 text-[10px] text-slate-500">
          Paid {formatDate(deal.brokerage_paid_at)}
        </p>
      )}

      {assigneeLabel && (
        <div className="mt-2 flex items-center justify-end">
          <span
            title={assigneeLabel}
            className="bg-primary/15 text-primary flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold"
          >
            {initials(assigneeLabel)}
          </span>
        </div>
      )}
    </button>
  );
}
