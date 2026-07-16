import { cn } from '@/lib/utils'

/**
 * A chat bubble with a classic three-dot "typing…" indicator, and a
 * smaller reply bubble that pops in above it like a message just
 * landed. Stands in for a spinner on the inbox conversation list and
 * message thread. Pure SVG + CSS (keyframes in globals.css).
 */
export function MessageBubbleLoader({
  size = 56,
  label = 'Loading messages',
  className,
}: {
  size?: number
  label?: string
  className?: string
}) {
  return (
    <div role="status" aria-label={label} className={cn('inline-flex', className)}>
      <svg className="msg-loader" width={size} height={size * 0.75} viewBox="0 0 120 90" aria-hidden="true">
        <rect className="bubble-out" x="52" y="6" width="52" height="26" rx="13" />
        <path className="bubble-in" d="M18 30h56a12 12 0 0 1 12 12v18a12 12 0 0 1-12 12H34l-14 12V60a12 12 0 0 1-12-12V42a12 12 0 0 1 12-12z" />
        <circle className="dot" cx="34" cy="54" r="4.5" style={{ animationDelay: '0s' }} />
        <circle className="dot" cx="50" cy="54" r="4.5" style={{ animationDelay: '0.15s' }} />
        <circle className="dot" cx="66" cy="54" r="4.5" style={{ animationDelay: '0.3s' }} />
      </svg>
    </div>
  )
}
