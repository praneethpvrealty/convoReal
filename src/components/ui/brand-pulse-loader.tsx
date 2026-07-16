import { cn } from '@/lib/utils'

/**
 * The app-wide default: a core dot breathing while rings ping outward,
 * like a heartbeat/radar ping with no literal page subject — used
 * where no page-specific loader applies yet (e.g. the dashboard shell
 * auth gate, which every authenticated page passes through). Pure SVG
 * + CSS (keyframes in globals.css).
 */
export function BrandPulseLoader({
  size = 64,
  label = 'Loading',
  className,
}: {
  size?: number
  label?: string
  className?: string
}) {
  return (
    <div role="status" aria-label={label} className={cn('inline-flex', className)}>
      <svg className="brand-pulse-loader" width={size} height={size} viewBox="0 0 120 120" style={{ overflow: 'visible' }} aria-hidden="true">
        <circle className="bp-ring" cx="60" cy="60" r="14" style={{ animationDelay: '0s' }} />
        <circle className="bp-ring" cx="60" cy="60" r="14" style={{ animationDelay: '0.8s' }} />
        <circle className="bp-ring" cx="60" cy="60" r="14" style={{ animationDelay: '1.6s' }} />
        <circle className="bp-core" cx="60" cy="60" r="13" />
      </svg>
    </div>
  )
}
