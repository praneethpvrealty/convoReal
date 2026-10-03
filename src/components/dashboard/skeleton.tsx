import { cn } from '@/lib/utils';

/**
 * Shared skeleton primitive — a pulsing slate block sized to whatever
 * container it's dropped into. Used by every dashboard widget while
 * its data fetches.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded-md bg-slate-800', className)} />
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-800 bg-slate-900 p-5',
        className
      )}
    >
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-4 h-8 w-20" />
      <Skeleton className="mt-2 h-3 w-16" />
    </div>
  );
}

export function TabSkeleton({
  label,
  tiles = 0,
  cards = 3,
}: {
  label: string;
  tiles?: number;
  cards?: number;
}) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-busy="true"
      className="space-y-6"
    >
      {tiles > 0 && (
        <div
          className={cn(
            'grid grid-cols-1 gap-4',
            tiles >= 4 ? 'md:grid-cols-2 lg:grid-cols-4' : 'md:grid-cols-3'
          )}
        >
          {Array.from({ length: tiles }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}
      <div className="space-y-4">
        {Array.from({ length: cards }, (_, i) => (
          <div
            key={i}
            className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-5"
          >
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-16 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
