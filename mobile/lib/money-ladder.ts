/**
 * The rupee ladder behind every "from / up to" money filter — contact
 * budgets on the Contacts tab, asking price on Properties.
 *
 * Mirrors the web Contacts page's BUDGET_OPTIONS
 * (src/lib/contacts/budget-options.ts). Kept in step by
 * src/lib/mobile-parity.test.ts, which reads this file by path.
 */
import { formatInr } from '@/lib/format';

/** The web ladder's values. Labels are derived rather than copied —
 *  `formatInr` already says "₹5 L" / "₹1.5 Cr", and a chip row has no
 *  room for "1.5 Crores". */
export const BUDGET_STEPS = [
  500000, 1000000, 2000000, 3000000, 4000000, 5000000, 6000000, 8000000,
  10000000, 15000000, 20000000, 30000000, 50000000, 70000000, 100000000,
  150000000, 200000000, 300000000, 500000000, 750000000, 1000000000,
  1500000000, 2000000000,
];

export function budgetStepLabel(value: number): string {
  return formatInr(value);
}
