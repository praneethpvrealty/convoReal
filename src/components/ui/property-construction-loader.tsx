import { cn } from '@/lib/utils'

/**
 * A crane swinging beside a building that rises floor by floor, then
 * fades to rebuild — literal "under construction" for the property
 * inventory's own loading state. Pure SVG + CSS (keyframes in
 * globals.css), same self-drawing family as property-blueprint-loader.tsx.
 */
export function PropertyConstructionLoader({
  size = 72,
  label = 'Loading',
  className,
}: {
  size?: number
  label?: string
  className?: string
}) {
  return (
    <div role="status" aria-label={label} className={cn('inline-flex', className)}>
      <svg className="construction-loader" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <line className="con-ground" x1="2" y1="58" x2="62" y2="58" />

        {/* Crane: fixed mast, swinging jib + hook */}
        <line className="con-mast" x1="14" y1="58" x2="14" y2="8" />
        <g className="con-arm">
          <line className="con-jib" x1="14" y1="8" x2="42" y2="8" />
          <line className="con-counterjib" x1="14" y1="8" x2="5" y2="8" />
          <line className="con-cable" x1="37" y1="8" x2="37" y2="24" />
          <rect className="con-hook" x="33" y="24" width="8" height="6" rx="1" />
        </g>

        {/* Building: floors rise into place one after another, then reset */}
        <g>
          <rect className="con-floor con-floor-1" x="44" y="48" width="16" height="10" />
          <rect className="con-floor con-floor-2" x="44" y="36" width="16" height="10" />
          <rect className="con-floor con-floor-3" x="44" y="24" width="16" height="10" />
        </g>
      </svg>
    </div>
  )
}
