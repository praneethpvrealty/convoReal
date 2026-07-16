import { cn } from '@/lib/utils'

/**
 * A clipboard ticking off three requirements one at a time — for the
 * Requirements consolidation page. Pure SVG + CSS (keyframes in
 * globals.css), same self-drawing checkmark technique as
 * property-blueprint-loader.tsx.
 */
export function ChecklistLoader({
  size = 64,
  label = 'Assembling requirements',
  className,
}: {
  size?: number
  label?: string
  className?: string
}) {
  const rows = [28, 46, 64]
  return (
    <div role="status" aria-label={label} className={cn('inline-flex', className)}>
      <svg className="checklist-loader" width={size * 0.78} height={size} viewBox="0 0 70 90" aria-hidden="true">
        <rect className="cl-clip" x="24" y="4" width="22" height="10" rx="3" />
        <rect className="cl-board" x="8" y="10" width="54" height="72" rx="6" />
        {rows.map((y, i) => (
          <g key={y}>
            <rect className="cl-box" x="16" y={y - 4} width="9" height="9" rx="2" />
            <path
              className="cl-check"
              style={{ animationDelay: `${i * 0.3}s` }}
              pathLength="1"
              d={`M18 ${y} L21 ${y + 3} L25 ${y - 3}`}
            />
            <rect className="cl-text" x="30" y={y - 2} width="26" height="4" rx="2" />
          </g>
        ))}
      </svg>
    </div>
  )
}
