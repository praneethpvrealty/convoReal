import { cn } from '@/lib/utils'

/**
 * A deal card hopping across three kanban columns, left to right — for
 * the Pipelines board. Pure SVG + CSS (keyframes in globals.css).
 */
export function PipelineStageLoader({
  size = 96,
  label = 'Loading pipeline',
  className,
}: {
  size?: number
  label?: string
  className?: string
}) {
  return (
    <div role="status" aria-label={label} className={cn('inline-flex', className)}>
      <svg className="pipeline-stage-loader" width={size} height={size * 0.5} viewBox="0 0 140 70" aria-hidden="true">
        <rect className="stage-col" x="4" y="5" width="36" height="60" rx="6" />
        <rect className="stage-col" x="52" y="5" width="36" height="60" rx="6" />
        <rect className="stage-col" x="100" y="5" width="36" height="60" rx="6" />
        <g className="stage-card">
          <rect width="26" height="16" rx="4" />
        </g>
      </svg>
    </div>
  )
}
