import { equivalentPriceLabel, priceInWords } from '@/lib/currency-utils'
import { cn } from '@/lib/utils'

interface PriceHintProps {
  /** The raw field value, exactly as the input holds it. */
  value: string | number | null | undefined
  currency?: string
  /** Drop the "Equivalent to: " prefix where the column is too narrow
   *  for it — side-by-side min/max budget pairs, mostly. */
  compact?: boolean
  className?: string
}

/**
 * The "Equivalent to: ₹16 Crore" line under an amount input.
 *
 * Prices are typed as digits — 160000000 — and a missing or extra zero is
 * invisible at that length, so every amount field wants this readout. It
 * renders nothing until the field holds a positive number, which is what
 * lets it sit under a field unconditionally: the call site is one line
 * with no guard to get wrong.
 */
export function PriceHint({ value, currency = 'INR', compact, className }: PriceHintProps) {
  const label = compact
    ? priceInWords(value, currency)
    : equivalentPriceLabel(value, currency)
  if (!label) return null
  return (
    <p className={cn('text-[11px] text-primary font-semibold mt-0.5', className)}>
      {label}
    </p>
  )
}
