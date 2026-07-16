import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { PropertyHouseGlyph } from '@/components/ui/property-house-glyph'

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-950 px-6 text-center">
      <PropertyHouseGlyph size={80} />
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">404</p>
        <h1 className="text-2xl font-semibold text-white">Site Visit Cancelled</h1>
        <p className="mx-auto max-w-sm text-sm text-slate-400">
          This page went to go check out a property and never came back.
          Last text: &ldquo;I&apos;m just 5 minutes away.&rdquo; That was an hour ago.
        </p>
      </div>
      <Link href="/" className={buttonVariants({ className: 'px-4' })}>
        Back to ConvoReal
      </Link>
    </div>
  )
}
