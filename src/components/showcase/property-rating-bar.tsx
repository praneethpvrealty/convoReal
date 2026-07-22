'use client';

import { CheckCircle, Sparkles } from 'lucide-react';

interface PropertyRatingBarProps {
  value: number | null;
  missReasons: string[];
  onRate: (rating: number) => void;
  onToggleReason: (reason: string) => void;
  onHide?: () => void;
  compact?: boolean;
}

export const RATING_MISS_REASONS: Array<{ key: string; label: string }> = [
  { key: 'budget', label: 'Budget mismatch' },
  { key: 'location', label: 'Location' },
  { key: 'property_type', label: 'Property type' },
  { key: 'size', label: 'Size / layout' },
  { key: 'other', label: 'Other' },
];

export const HIGH_INTEREST_RATING = 7;

function segmentColor(segment: number, value: number | null): string {
  if (value === null || segment > value) {
    return 'bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-600 hover:text-slate-300';
  }
  if (value >= HIGH_INTEREST_RATING) {
    return 'bg-emerald-500/80 border-emerald-400 text-white';
  }
  if (value >= 4) {
    return 'bg-amber-500/70 border-amber-400 text-white';
  }
  return 'bg-rose-500/70 border-rose-400 text-white';
}

/**
 * One-tap 1–10 buyer interest rating — the single feedback control on the
 * public showcase (replaces the separate Like and Interested prompts).
 * Ratings below 7 reveal optional "where's the miss?" chips; everything is
 * anonymous and saved on tap, so the feedback loop stays friction-free.
 */
export function PropertyRatingBar({
  value,
  missReasons,
  onRate,
  onToggleReason,
  onHide,
  compact = false,
}: PropertyRatingBarProps) {
  const rated = value !== null;
  const isHighInterest = rated && value >= HIGH_INTEREST_RATING;

  return (
    <div
      className={
        compact
          ? 'space-y-2'
          : 'border-slate-850 space-y-3 rounded-xl border bg-slate-950/30 p-4'
      }
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <h5
            className={`text-slate-350 font-bold tracking-wider uppercase ${compact ? 'text-[10px]' : 'text-[11px]'}`}
          >
            {rated ? `You rated this ${value}/10` : 'How well does this fit?'}
          </h5>
          {!compact && (
            <p className="text-[10px] text-slate-500">
              One tap — 1 means not for me, 10 means perfect fit. It helps us
              match you better.
            </p>
          )}
        </div>
        {isHighInterest && (
          <span className="flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
            <Sparkles className="size-3" />
            High interest
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((segment) => (
          <button
            key={segment}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRate(segment);
            }}
            aria-pressed={value === segment}
            title={`Rate ${segment}/10`}
            className={`min-w-0 flex-1 cursor-pointer rounded-md border font-bold transition-all ${
              compact ? 'h-6 text-[9px]' : 'h-7.5 text-[10px]'
            } ${segmentColor(segment, value)}`}
          >
            {segment}
          </button>
        ))}
      </div>

      {isHighInterest && !compact && (
        <p className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-400">
          <CheckCircle className="size-3.5 shrink-0" />
          Great fit! The agent will prioritise a follow-up on this one.
        </p>
      )}

      {rated && value < HIGH_INTEREST_RATING && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-slate-500">
            Where&apos;s the miss?{' '}
            <span className="text-slate-600">
              (optional — helps us find you better matches)
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {RATING_MISS_REASONS.map(({ key, label }) => {
              const selected = missReasons.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleReason(key);
                  }}
                  className={`cursor-pointer rounded-full border px-2.5 py-1 text-[10px] font-bold transition-all ${
                    selected
                      ? 'bg-primary border-primary shadow-primary/20 text-white shadow-md'
                      : 'border-slate-850 bg-slate-950 text-slate-400 hover:border-slate-700 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              );
            })}
            {onHide && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onHide();
                }}
                className="cursor-pointer rounded-full border border-slate-900 bg-slate-950 px-2.5 py-1 text-[10px] font-semibold text-slate-500 transition-all hover:border-red-500/30 hover:text-red-400"
              >
                Hide this property
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
