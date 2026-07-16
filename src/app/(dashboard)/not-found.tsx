import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { PropertyHouseGlyph } from '@/components/ui/property-house-glyph'

export default function DashboardNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-6 text-center">
      <PropertyHouseGlyph size={72} />
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">404</p>
        <h1 className="text-xl font-semibold text-white">This Listing Walked Off the Market</h1>
        <p className="mx-auto max-w-sm text-sm text-slate-400">
          Whatever you were looking for isn&apos;t at this address anymore —
          reassigned, archived, or an agent got trigger-happy with the delete button.
        </p>
      </div>
      <div className="flex gap-3">
        <Link
          href="/inventory"
          className={buttonVariants({ variant: 'outline', className: 'px-4' })}
        >
          Back to Inventory
        </Link>
        <Link href="/dashboard" className={buttonVariants({ className: 'px-4' })}>
          Back to Dashboard
        </Link>
      </div>
    </div>
  )
}
