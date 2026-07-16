import { cn } from '@/lib/utils'

/**
 * A calendar grid with "today" glowing while the rest wait their turn
 * — for the Calendar page. Pure SVG + CSS (keyframes in globals.css).
 */
export function CalendarLoader({
  size = 64,
  label = 'Loading calendar',
  className,
}: {
  size?: number
  label?: string
  className?: string
}) {
  const cells = Array.from({ length: 12 })
  return (
    <div role="status" aria-label={label} className={cn('inline-flex', className)}>
      <svg className="calendar-loader" width={size} height={size} viewBox="0 0 80 80" aria-hidden="true">
        <rect className="cal-tab" x="22" y="6" width="6" height="14" rx="3" />
        <rect className="cal-tab" x="52" y="6" width="6" height="14" rx="3" />
        <rect className="cal-body" x="10" y="16" width="60" height="54" rx="6" />
        <rect className="cal-header" x="10" y="16" width="60" height="14" rx="6" />
        <rect className="cal-header" x="10" y="24" width="60" height="6" />
        {cells.map((_, i) => {
          const col = i % 4
          const row = Math.floor(i / 4)
          const x = 18 + col * 13
          const y = 38 + row * 11
          const isToday = i === 6
          return (
            <rect
              key={i}
              className={isToday ? 'cal-cell cal-today' : 'cal-cell'}
              x={x}
              y={y}
              width="8"
              height="6"
              rx="1.5"
            />
          )
        })}
      </svg>
    </div>
  )
}
