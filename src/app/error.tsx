'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { PropertyHouseGlyph } from '@/components/ui/property-house-glyph'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[error boundary]', error)
    // Report it too: a crash that only happens on someone else's device
    // is otherwise invisible — see /api/client-error.
    try {
      void fetch('/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: error?.message,
          digest: error?.digest,
          stack: error?.stack,
          url: typeof window !== 'undefined' ? window.location.href : '',
          buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? '',
        }),
        keepalive: true,
      }).catch(() => {})
    } catch {
      // reporting must never mask the original failure
    }
  }, [error])

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-950 px-6 text-center">
      <PropertyHouseGlyph size={80} />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-white">Our Agent Is Running Late</h1>
        <p className="mx-auto max-w-sm text-sm text-slate-400">
          Something broke loading this page. They swore they&apos;d have it
          ready by now — probably stuck showing another property.
        </p>
      </div>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className={buttonVariants({ variant: 'outline', className: 'px-4' })}
        >
          Try Again
        </button>
        <Link href="/" className={buttonVariants({ className: 'px-4' })}>
          Go Home
        </Link>
      </div>
    </div>
  )
}
