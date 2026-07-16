import { cn } from '@/lib/utils'

/**
 * A megaphone broadcasting expanding rings — for Broadcasts and Ads,
 * the two "push a message out to a lot of people" pages. Pure SVG +
 * CSS (keyframes in globals.css), same ring-pulse technique as
 * property-radar-loader.tsx.
 */
export function SignalWaveLoader({
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
      <svg className="signal-wave-loader" width={size} height={size * 0.85} viewBox="0 0 90 76" style={{ overflow: 'visible' }} aria-hidden="true">
        <circle className="wave-ring" cx="54" cy="34" r="6" style={{ animationDelay: '0s' }} />
        <circle className="wave-ring" cx="54" cy="34" r="6" style={{ animationDelay: '0.6s' }} />
        <circle className="wave-ring" cx="54" cy="34" r="6" style={{ animationDelay: '1.2s' }} />
        <path className="horn-shape" d="M8 24h20l24-16v52l-24-16H8z" />
        <rect className="horn-handle" x="2" y="28" width="8" height="12" rx="2" />
      </svg>
    </div>
  )
}
