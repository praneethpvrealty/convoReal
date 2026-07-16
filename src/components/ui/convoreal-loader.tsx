import { cn } from '@/lib/utils'

/**
 * The common app-wide loader: the ConvoReal wordmark with a bright
 * band sweeping through the letters (background-clip: text shimmer —
 * the "flashing brand name" treatment). Used wherever a page doesn't
 * have its own themed loader (auth gate, admin, agents, invite,
 * profile setup); the page-specific loaders stay on their pages.
 * Colored by var(--primary) so it follows all 5 accent themes.
 *
 * `size` is the font size in px.
 */
export function ConvoRealLoader({
  size = 24,
  label = 'Loading',
  className,
}: {
  size?: number
  label?: string
  className?: string
}) {
  return (
    <div role="status" aria-label={label} className={cn('inline-flex', className)}>
      <span className="cr-flash" style={{ fontSize: size }} aria-hidden="true">
        ConvoReal
      </span>
    </div>
  )
}
