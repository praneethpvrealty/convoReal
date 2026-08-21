'use client';

import type { ReactNode } from 'react';
import { CheckSquare, Square } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * One selectable match row, shared by every surface that offers a
 * ranked target: the property share dialog's Matching Contacts step and
 * Match Radar's target feed. The two used to draw the same row twice,
 * so a change to how a match reads — the enquiry line, the score
 * colours — landed on one screen and not the other.
 *
 * Mobile parity: mobile/components/match-target-row.tsx.
 */
export type MatchTargetTone = 'strong' | 'fair' | 'weak' | 'accent';

interface MatchTargetRowProps {
  name: string;
  detail?: string | null;
  /** Enquiry labels, newest first — what this contact already asked about. */
  inquiries?: string[];
  scoreLabel: string;
  tone?: MatchTargetTone;
  /** Classification and name tags, rendered beside the name. */
  badges?: ReactNode;
  /** Match chips — MatchDetailChips on the dialog, plain text on Radar. */
  chips?: ReactNode;
  selected: boolean;
  onToggle: () => void;
  /** Compact rows sit two-up in Radar's feed; the dialog runs full width. */
  density?: 'comfortable' | 'compact';
}

const TONE_CLASS: Record<MatchTargetTone, string> = {
  strong: 'bg-green-500/10 text-green-400 border-green-500/20',
  fair: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  weak: 'bg-slate-800 text-slate-400 border-slate-800',
  accent: 'bg-primary/10 text-primary border-primary/20',
};

export function MatchTargetRow({
  name,
  detail,
  inquiries = [],
  scoreLabel,
  tone = 'weak',
  badges,
  chips,
  selected,
  onToggle,
  density = 'comfortable',
}: MatchTargetRowProps) {
  const compact = density === 'compact';
  return (
    <div
      onClick={onToggle}
      role="checkbox"
      aria-checked={selected}
      aria-label={`Select ${name}`}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onToggle();
        }
      }}
      className={cn(
        'flex items-start gap-3 rounded-xl border cursor-pointer transition-all select-none',
        compact ? 'p-2.5 gap-2.5 rounded-lg' : 'p-3 gap-3.5',
        selected
          ? 'bg-primary/5 border-primary/45 ring-1 ring-primary/10'
          : 'bg-slate-900/50 border-slate-800 hover:border-slate-750'
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        className={cn('shrink-0 mt-0.5', selected ? 'text-primary' : 'text-slate-650')}
      >
        {selected ? <CheckSquare className="size-4" /> : <Square className="size-4" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <h4
              className={cn(
                'font-bold text-white truncate',
                compact ? 'text-[11px]' : 'text-xs'
              )}
            >
              {name}
            </h4>
            {badges}
          </div>
          <span
            className={cn(
              'inline-flex items-center rounded border px-1.5 py-0.5 font-bold shrink-0',
              compact ? 'text-[9px]' : 'text-[9px]',
              TONE_CLASS[tone]
            )}
          >
            {scoreLabel}
          </span>
        </div>
        {detail && (
          <p className="text-[11px] text-slate-500 font-mono mt-0.5 truncate">{detail}</p>
        )}
        {inquiries.length > 0 && (
          <p className="text-[10px] text-slate-500 mt-1 truncate">
            <span className="text-slate-400 font-semibold">Enquired: </span>
            {inquiries.join(' · ')}
          </p>
        )}
        {chips}
      </div>
    </div>
  );
}
