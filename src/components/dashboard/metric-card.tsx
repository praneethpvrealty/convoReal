import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'
import { InfoHint } from '@/components/ui/info-hint'

interface MetricCardProps {
  title: string
  /** Pre-formatted value for display (e.g. "42" or "$1,250"). */
  value: string
  icon: ComponentType<{ className?: string }>
  /**
   * Delta-mode secondary row: arrow + delta text. Omit when the metric
   * doesn't have a sensible comparison (e.g. total pipeline value).
   */
  delta?: {
    /** Positive / negative / zero drives arrow + color. */
    sign: number
    /** Pre-formatted delta, e.g. "+3 vs yesterday". */
    label: string
  }
  /** Used instead of `delta` when the metric has a static subtitle. */
  subtitle?: string
  highlight?: boolean
  hint?: string
}

export function MetricCard({ title, value, icon: Icon, delta, subtitle, highlight, hint }: MetricCardProps) {
  return (
    <div className={cn(
      "rounded-2xl border p-5 backdrop-blur-sm shadow-md transition-all duration-300 relative group overflow-hidden",
      highlight
        ? "border-primary bg-slate-900/65 shadow-lg shadow-primary/15 ring-1 ring-primary/25"
        : "border-slate-800/80 bg-slate-900/45 hover:border-primary/20 hover:shadow-primary/5 hover:shadow-lg hover:scale-[1.01]"
    )}>
      {/* Dynamic theme accent glow inside card */}
      <div className="absolute top-0 right-0 w-28 h-28 bg-primary/5 rounded-full blur-[28px] pointer-events-none group-hover:bg-primary/10 transition-all duration-300" />
      
      <div className="flex items-start justify-between relative z-10">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center">
          {title}
          {hint && <InfoHint text={hint} />}
        </p>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-sm shadow-primary/5 transition-all duration-300 group-hover:scale-105 group-hover:bg-primary/20 shrink-0">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-4 text-[26px] leading-none font-black tracking-tight tabular-nums text-white relative z-10 transition-colors duration-500">
        {value}
      </p>
      <div className="relative z-10">
        {delta ? <DeltaRow sign={delta.sign} label={delta.label} /> : subtitle ? (
          <p className="mt-2 text-xs font-medium text-slate-500">{subtitle}</p>
        ) : null}
      </div>
    </div>
  )
}

function DeltaRow({ sign, label }: { sign: number; label: string }) {
  const tone =
    sign > 0
      ? 'text-primary'
      : sign < 0
      ? 'text-red-400'
      : 'text-slate-500'
  const Arrow = sign > 0 ? ArrowUp : sign < 0 ? ArrowDown : Minus
  return (
    <div className={cn('mt-2 flex items-center gap-1 text-sm', tone)}>
      <Arrow className="h-4 w-4" aria-hidden />
      <span className="tabular-nums">{label}</span>
    </div>
  )
}
