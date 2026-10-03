import { Skeleton } from '@/components/dashboard/skeleton';

/**
 * Calendar loading skeleton — mirrors the calendar page layout so the route
 * does not flash an unrelated placeholder while the page hydrates.
 */
const CHIP_CELLS: Record<number, number> = {
  4: 1,
  9: 2,
  12: 1,
  17: 1,
  20: 2,
  26: 1,
  31: 1,
  36: 2,
};

export function CalendarGridSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading calendar"
      aria-busy="true"
      className="flex flex-1 flex-col"
    >
      <div className="mb-2 grid grid-cols-7 gap-px">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex justify-center py-1">
            <Skeleton className="h-3 w-8" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-slate-800/40">
        {Array.from({ length: 42 }, (_, i) => (
          <div key={i} className="min-h-[88px] space-y-1.5 bg-slate-950 p-2">
            <Skeleton className="h-5 w-5 rounded-full" />
            {Array.from({ length: CHIP_CELLS[i] ?? 0 }, (_, c) => (
              <Skeleton key={c} className="h-4 w-full" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CalendarPageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-11 w-full rounded-xl" />
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex-1 rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="mb-4 flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
            <Skeleton className="h-7 w-44" />
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-8 w-24" />
            </div>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-5 w-16 rounded-full" />
            ))}
          </div>
          <CalendarGridSkeleton />
        </div>
        <div className="w-full shrink-0 space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-6 lg:w-80">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-9 w-full rounded-lg" />
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default CalendarPageSkeleton;
