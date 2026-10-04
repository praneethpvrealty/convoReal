import { cn } from '@/lib/utils';

interface JourneyListSkeletonProps {
  header?: 'none' | 'compact' | 'full';
  className?: string;
}

const STAGE_ROWS = 6;

/**
 * Holds the Journeys layout in place while stages and journeys load,
 * so the Deals page does not swap a full-height loader in and out.
 */
export function JourneyListSkeleton({
  header = 'none',
  className,
}: JourneyListSkeletonProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading journeys"
      className={cn('space-y-5', className)}
    >
      {header !== 'none' && (
        <div className="flex flex-wrap items-start justify-between gap-4">
          {header === 'full' ? (
            <div className="space-y-2">
              <div className="h-9 w-40 animate-pulse rounded-lg bg-slate-800/60" />
              <div className="h-4 w-72 max-w-full animate-pulse rounded bg-slate-800/40" />
            </div>
          ) : (
            <div />
          )}
          <div className="h-8 w-40 animate-pulse rounded-md bg-slate-800/60" />
        </div>
      )}
      <div className="space-y-3">
        <div className="h-14 animate-pulse rounded-xl border border-slate-800 bg-slate-950/90" />
        {Array.from({ length: STAGE_ROWS }, (_, index) => (
          <div
            key={index}
            className="h-12 animate-pulse rounded-xl border border-slate-800 bg-slate-900/40"
          />
        ))}
      </div>
    </div>
  );
}
