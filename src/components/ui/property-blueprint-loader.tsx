import { cn } from '@/lib/utils'

/**
 * A single-stroke house that draws itself — outline, then door, then
 * window — before fading to redraw. Stands in as the placeholder
 * where a property's own photo/artwork is being generated or
 * uploaded, rather than floating a spinner on top of one. Pure SVG +
 * CSS (keyframes in globals.css), no icon-library dependency.
 *
 * Uses SVG `pathLength="1"` so the draw animation never needs
 * hand-measured path lengths.
 */
export function PropertyBlueprintLoader({
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
      <svg className="blueprint-loader" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <path className="h-outline" pathLength="1" d="M8 54 L8 27 L32 6 L56 27 L56 54 Z" />
        <path className="h-door" pathLength="1" d="M26 54 L26 37 L38 37 L38 54" />
        <path className="h-window" pathLength="1" d="M42 30 L50 30 L50 38 L42 38 Z" />
      </svg>
    </div>
  )
}
