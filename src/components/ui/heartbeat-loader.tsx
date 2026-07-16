import { cn } from '@/lib/utils'

/**
 * An ECG line that continuously re-traces its own heartbeat spike —
 * the obvious pun for the Pulse page's activity feed. Pure SVG + CSS
 * (keyframes in globals.css), same self-drawing technique as
 * property-blueprint-loader.tsx.
 */
export function HeartbeatLoader({
  size = 96,
  label = 'Loading activity',
  className,
}: {
  size?: number
  label?: string
  className?: string
}) {
  return (
    <div role="status" aria-label={label} className={cn('inline-flex', className)}>
      <svg className="heartbeat-loader" width={size} height={size * 0.4} viewBox="0 0 160 64" aria-hidden="true">
        <path className="ekg-track" d="M0 32 H44 L54 12 L66 52 L76 24 L84 32 H160" />
        <path className="ekg-sweep" pathLength="1" d="M0 32 H44 L54 12 L66 52 L76 24 L84 32 H160" />
        <circle className="ekg-dot" cx="156" cy="32" r="4" />
      </svg>
    </div>
  )
}
