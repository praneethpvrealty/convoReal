import { Skeleton } from '@/components/dashboard/skeleton'

/**
 * Showcase loading skeleton — shown while the server component fetches
 * properties, settings, and referrer data. Dark-themed to match the showcase.
 */
export default function ShowcaseLoading() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header skeleton */}
      <div className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
      </div>

      {/* Hero / featured skeleton */}
      <div className="mx-auto max-w-7xl px-4 py-6">
        <Skeleton className="h-6 w-64 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden"
            >
              {/* Image area */}
              <Skeleton className="h-48 w-full rounded-none" />
              <div className="p-4 space-y-3">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <div className="flex items-center gap-2 pt-1">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <div className="flex items-center justify-between pt-2">
                  <Skeleton className="h-6 w-24" />
                  <Skeleton className="h-8 w-28 rounded-lg" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
