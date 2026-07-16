import { cn } from '@/lib/utils'

/**
 * A contact card being scanned top-to-bottom, avatar and detail lines
 * already in place — for the Contacts table and CSV import. Pure SVG
 * + CSS (keyframes in globals.css).
 */
export function ContactCardLoader({
  size = 64,
  label = 'Loading contacts',
  className,
}: {
  size?: number
  label?: string
  className?: string
}) {
  return (
    <div role="status" aria-label={label} className={cn('inline-flex', className)}>
      <svg className="contact-card-loader" width={size} height={size * 0.7} viewBox="0 0 100 70" aria-hidden="true">
        <rect className="card-body" x="5" y="5" width="90" height="60" rx="8" />
        <circle className="card-avatar" cx="26" cy="30" r="10" />
        <rect className="card-line" x="43" y="24" width="40" height="5" rx="2.5" />
        <rect className="card-line" x="43" y="35" width="27" height="4" rx="2" />
        <rect className="card-line" x="16" y="48" width="68" height="4" rx="2" />
        <clipPath id="cardClip">
          <rect x="5" y="5" width="90" height="60" rx="8" />
        </clipPath>
        <rect className="card-scan" x="5" y="5" width="90" height="12" rx="6" clipPath="url(#cardClip)" />
      </svg>
    </div>
  )
}
