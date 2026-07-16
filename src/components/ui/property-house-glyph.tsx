/**
 * Static line-art house — the resting/no-motion sibling of
 * PropertyBlueprintLoader (src/components/ui/property-blueprint-loader.tsx).
 * Same silhouette so the two read as one visual family: the loader
 * draws this shape while something is happening, this glyph is what's
 * left standing when nothing is — used on 404 / error pages, never on
 * an actual loading state.
 */
export function PropertyHouseGlyph({
  size = 72,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke="var(--primary)"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M8 54 L8 27 L32 6 L56 27 L56 54 Z" />
      <path d="M26 54 L26 37 L38 37 L38 54" />
      <path d="M42 30 L50 30 L50 38 L42 38 Z" />
    </svg>
  )
}
