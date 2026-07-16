import { cn } from '@/lib/utils'

/**
 * A literal radar dish: a fading wedge sweeps around a ringed scope
 * while blips flash where it's already passed — for the Match Radar
 * page, distinct from property-radar-loader.tsx's pin-with-rings
 * (that one's a map pin; this one's the actual radar screen). Pure
 * SVG + CSS (keyframes in globals.css).
 */
export function RadarSweepLoader({
  size = 88,
  label = 'Scanning for matches',
  className,
}: {
  size?: number
  label?: string
  className?: string
}) {
  return (
    <div role="status" aria-label={label} className={cn('inline-flex', className)}>
      <svg className="radar-sweep-loader" width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          <linearGradient id="radarSweepFade" x1="60" y1="60" x2="60" y2="10" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--primary)" stopOpacity="0" />
            <stop offset="1" stopColor="var(--primary)" stopOpacity="0.55" />
          </linearGradient>
        </defs>
        <circle className="scope-ring" cx="60" cy="60" r="48" />
        <circle className="scope-ring" cx="60" cy="60" r="32" />
        <circle className="scope-ring" cx="60" cy="60" r="16" />
        <circle className="blip" cx="82" cy="34" r="3" style={{ animationDelay: '0s' }} />
        <circle className="blip" cx="34" cy="72" r="3" style={{ animationDelay: '1s' }} />
        <circle className="blip" cx="78" cy="82" r="3" style={{ animationDelay: '2s' }} />
        <g className="sweep-group">
          <path className="sweep-wedge" d="M60 60 L60 12 A48 48 0 0 1 80.4 20.2 Z" fill="url(#radarSweepFade)" />
          <line className="sweep-line" x1="60" y1="60" x2="60" y2="12" />
        </g>
      </svg>
    </div>
  )
}
