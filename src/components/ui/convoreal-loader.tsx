import { cn } from '@/lib/utils'

/**
 * The brand mark dressed as a payment-gateway spinner: the ConvoReal
 * tile (same rounded-square + chat-bubble glyph as src/app/icon.tsx
 * and the sidebar logo) sits still in the center while an
 * indeterminate arc orbits it — growing, shrinking, and chasing
 * itself around the track, Razorpay-checkout style. `wordmark` adds
 * "ConvoReal" with a blinking ellipsis underneath for full-page
 * states. Pure SVG/CSS (keyframes in globals.css), colored only by
 * --primary/--primary-hover so it follows all 5 accent themes.
 *
 * `size` is the tile; the orbit ring extends the footprint to ~1.8x.
 */
export function ConvoRealLoader({
  size = 40,
  label = 'Loading',
  wordmark = false,
  className,
}: {
  size?: number
  label?: string
  wordmark?: boolean
  className?: string
}) {
  const radius = Math.max(6, Math.round(size * 0.22))
  const box = Math.round(size * 1.8)
  return (
    <div role="status" aria-label={label} className={cn('inline-flex flex-col items-center gap-3', className)}>
      <div className="convoreal-loader" style={{ width: box, height: box }}>
        <svg className="cr-orbit" viewBox="0 0 100 100" width={box} height={box} aria-hidden="true">
          <circle className="cr-orbit-track" cx="50" cy="50" r="45" />
          <circle className="cr-orbit-arc" cx="50" cy="50" r="45" />
        </svg>
        <div className="cr-tile" style={{ width: size, height: size, borderRadius: radius }}>
          <svg
            width={size * 0.52}
            height={size * 0.52}
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="cr-sheen" />
        </div>
      </div>
      {wordmark && (
        <span className="cr-word">
          ConvoReal
          <span className="cr-ellipsis" aria-hidden="true">
            <span style={{ animationDelay: '0s' }}>.</span>
            <span style={{ animationDelay: '0.2s' }}>.</span>
            <span style={{ animationDelay: '0.4s' }}>.</span>
          </span>
        </span>
      )}
    </div>
  )
}
