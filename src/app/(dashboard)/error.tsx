'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { PropertyHouseGlyph } from '@/components/ui/property-house-glyph'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[dashboard error boundary]', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-6 text-center">
      <PropertyHouseGlyph size={72} />
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-white">Hold On, Just Wrapping Up a Call</h1>
        <p className="mx-auto max-w-sm text-sm text-slate-400">
          Something went wrong loading this page. We&apos;re &ldquo;circling
          back&rdquo; on it shortly — should only be five more minutes.
        </p>
      </div>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className={buttonVariants({ variant: 'outline', className: 'px-4' })}
        >
          Try Again
        </button>
        <Link href="/dashboard" className={buttonVariants({ className: 'px-4' })}>
          Back to Dashboard
        </Link>
      </div>
    </div>
  )
}
