/**
 * What the brokerage on a deal is worth, and how much of it one invoice
 * claims.
 *
 * The calculation was written inline three times — twice in
 * `deal-form.tsx` (once to save, once to preview, and the preview did
 * not round) and once in the mobile deals screen as a hardcoded
 * `× 0.02` fallback. Invoicing makes a fourth copy unacceptable: the
 * figure the agent previews, the figure stored on the deal, and the
 * figure printed on a customer's invoice have to be the same number.
 */

export type BrokerageType = 'percentage' | 'fixed';

export interface BrokerageInput {
  dealValue: number | string | null | undefined;
  type: BrokerageType | null | undefined;
  /** The percentage when `type` is 'percentage', the amount when 'fixed'. */
  value: number | string | null | undefined;
}

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The whole brokerage the deal earns, across both sides.
 *
 * Not rounded: rounding belongs at the invoice, where a rupee is
 * printed. Rounding here and again at the share would compound.
 */
export function brokerageAmount(input: BrokerageInput): number {
  const dealValue = toNumber(input.dealValue);
  const value = toNumber(input.value);
  if (value <= 0) return 0;
  if (input.type === 'fixed') return value;
  return (dealValue * value) / 100;
}

/**
 * One side's slice, rounded to the rupee.
 *
 * This is the `ROUND(162000000*0.7%/2, 0)` on the reference invoice: a
 * 0.7% brokerage split down the middle, with the buyer billed 5,67,000
 * and the seller the other half. Paise never appear on these invoices,
 * and `Math.round` is what the spreadsheet's ROUND does for positive
 * numbers.
 */
export function invoiceShare(
  amount: number,
  sharePercent: number | string | null | undefined
): number {
  const share = toNumber(sharePercent);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (share <= 0) return 0;
  return Math.round((amount * Math.min(share, 100)) / 100);
}

/** `brokerageAmount` and `invoiceShare` in one step, for the invoice path. */
export function brokerageShare(
  input: BrokerageInput,
  sharePercent: number | string | null | undefined
): number {
  return invoiceShare(brokerageAmount(input), sharePercent);
}
