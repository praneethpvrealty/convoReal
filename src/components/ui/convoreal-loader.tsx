import { cn } from '@/lib/utils'

/**
 * The actual brand mark — same rounded-square tile + chat-bubble glyph
 * as src/app/icon.tsx and the sidebar logo — breathing gently with a
 * light sweep and a soft pulse ring. This is the catch-all loader for
 * every page that doesn't have (or doesn't warrant) its own bespoke
 * loader; `wordmark` adds "ConvoReal" underneath for full-page states.
 * Pure SVG/CSS (keyframes in globals.css), colored only by
 * --primary/--primary-hover so it follows all 5 accent themes.
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
  return (
    <div role="status" aria-label={label} className={cn('inline-flex flex-col items-center gap-2.5', className)}>
      <div className="convoreal-loader" style={{ width: size, height: size, overflow: 'visible' }}>
        <span className="cr-ring" style={{ borderRadius: radius }} />
        <div className="cr-tile" style={{ borderRadius: radius }}>
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
      {wordmark && <span className="cr-word">ConvoReal</span>}
    </div>
  )
}
