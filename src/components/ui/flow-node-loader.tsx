import { cn } from '@/lib/utils'

/**
 * A pulse traveling down a three-node chain, lighting each node as it
 * arrives — for Automations and Flows. Pure SVG + CSS (keyframes in
 * globals.css).
 */
export function FlowNodeLoader({
  size = 96,
  label = 'Loading',
  className,
}: {
  size?: number
  label?: string
  className?: string
}) {
  return (
    <div role="status" aria-label={label} className={cn('inline-flex', className)}>
      <svg className="flow-node-loader" width={size} height={size * 0.36} viewBox="0 0 140 50" aria-hidden="true">
        <line className="flow-line" x1="23" y1="25" x2="62" y2="25" />
        <line className="flow-line" x1="78" y1="25" x2="117" y2="25" />
        <circle className="flow-node" cx="15" cy="25" r="8" style={{ animationDelay: '0s' }} />
        <circle className="flow-node" cx="70" cy="25" r="8" style={{ animationDelay: '1.1s' }} />
        <circle className="flow-node" cx="125" cy="25" r="8" style={{ animationDelay: '2.2s' }} />
        <circle className="flow-pulse" cx="15" cy="25" r="4" />
      </svg>
    </div>
  )
}
