import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import type { ComponentType } from 'react';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/ui/info-hint';

interface MetricCardProps {
  title: string;
  /** Pre-formatted value for display (e.g. "42" or "$1,250"). */
  value: string;
  icon: ComponentType<{ className?: string }>;
  /**
   * Delta-mode secondary row: arrow + "N more/fewer than yesterday".
   * Omit when the metric doesn't have a sensible comparison (e.g.
   * total pipeline value). `direction: 'neutral'` keeps both a rise
   * and a drop slate for metrics with no clear good direction.
   */
  delta?: {
    value: number;
    direction?: 'higher-is-better' | 'neutral';
  };
  /** Used instead of `delta` when the metric has a static subtitle. */
  subtitle?: string;
  highlight?: boolean;
  hint?: string;
}

export function MetricCard({
  title,
  value,
  icon: Icon,
  delta,
  subtitle,
  highlight,
  hint,
}: MetricCardProps) {
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-2xl border p-5 shadow-md backdrop-blur-sm transition-all duration-300',
        highlight
          ? 'border-primary shadow-primary/15 ring-primary/25 bg-slate-900/65 shadow-lg ring-1'
          : 'hover:border-primary/20 hover:shadow-primary/5 border-slate-800/80 bg-slate-900/45 hover:scale-[1.01] hover:shadow-lg'
      )}
    >
      {/* Dynamic theme accent glow inside card */}
      <div className="bg-primary/5 group-hover:bg-primary/10 pointer-events-none absolute top-0 right-0 h-28 w-28 rounded-full blur-[28px] transition-all duration-300" />

      <div className="relative z-10 flex items-start justify-between">
        <p className="flex items-center text-xs font-bold tracking-wider text-slate-400 uppercase">
          {title}
          {hint && <InfoHint text={hint} />}
        </p>
        <div className="bg-primary/10 text-primary border-primary/20 shadow-primary/5 group-hover:bg-primary/20 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border shadow-sm transition-all duration-300 group-hover:scale-105">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="relative z-10 mt-4 text-[26px] leading-none font-black tracking-tight text-white tabular-nums transition-colors duration-500">
        {value}
      </p>
      <div className="relative z-10">
        {delta ? (
          <DeltaRow
            value={delta.value}
            direction={delta.direction ?? 'higher-is-better'}
          />
        ) : subtitle ? (
          <p className="mt-2 text-xs font-medium text-slate-500">{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}

export function deltaCopy(value: number): string {
  if (value === 0) return 'Same as yesterday';
  const amount = Math.abs(value).toLocaleString();
  return `${amount} ${value > 0 ? 'more' : 'fewer'} than yesterday`;
}

function DeltaRow({
  value,
  direction,
}: {
  value: number;
  direction: 'higher-is-better' | 'neutral';
}) {
  const tone =
    direction === 'neutral' || value === 0
      ? 'text-slate-400'
      : value > 0
        ? 'text-primary'
        : 'text-red-400';
  const Arrow = value > 0 ? ArrowUp : value < 0 ? ArrowDown : Minus;
  return (
    <div className={cn('mt-2 flex items-center gap-1 text-sm', tone)}>
      <Arrow className="h-4 w-4" aria-hidden />
      <span className="tabular-nums">{deltaCopy(value)}</span>
    </div>
  );
}
