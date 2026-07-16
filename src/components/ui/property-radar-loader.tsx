import { cn } from '@/lib/utils'

/**
 * A location pin broadcasting expanding rings, like an active radar
 * sweep — same "still searching for matches" language Match Radar
 * already uses elsewhere. Pure SVG + CSS (keyframes in globals.css),
 * no icon-library dependency; drop-in replacement for a Loader2
 * spinner on full-page/section loading states.
 *
 * `inline` trims the ring count and speeds the cycle up so it stays
 * legible down to ~20px next to text.
 */
export function PropertyRadarLoader({
  size = 72,
  label = 'Loading',
  className,
}: {
  size?: number
  label?: string
  className?: string
}) {
  const inline = size <= 32
  const ringCount = inline ? 2 : 3

  return (
    <div role="status" aria-label={label} className={cn('inline-flex', className)}>
      <svg
        className={cn('pin-loader', inline && 'pin-loader-inline')}
        width={size}
        height={size * 1.1}
        viewBox="0 0 200 220"
        style={{ overflow: 'visible' }}
        aria-hidden="true"
      >
        <g>
          {Array.from({ length: ringCount }).map((_, i) => (
            <circle key={i} className="ring" cx="100" cy="85" r="16" />
          ))}
        </g>
        <g className="pin-group">
          <path
            className="pin-shape"
            d="M100 40c-24.85 0-45 20.15-45 45 0 33.75 45 78 45 78s45-44.25 45-78c0-24.85-20.15-45-45-45z"
          />
          <circle className="pin-hole" cx="100" cy="85" r="15" />
        </g>
      </svg>
    </div>
  )
}
