/**
 * The money a deal card, a stage header and the board's analytics
 * show, computed once so every surface prints the same number.
 *
 * The fee is the brokerage the deal has actually recorded: the saved
 * amount, or the rate applied to the value. A deal with neither has no
 * fee yet, and says so, rather than being guessed at 2% on one screen
 * and ₹0 on the next — that guess is what put "Fee: ₹0" under a ₹17 Cr
 * card and ₹0 in the header of a column holding 24 deals.
 *
 * Dependency-free: the mobile bundle imports this through `@shared/`.
 */

import { netOfPayouts } from '../deals/co-broking';
import { formatCurrency, formatInrCompact } from '../format/currency';
import { brokerageAmount } from './brokerage';

export interface DealMoneyInput {
  value?: number | string | null;
  brokerage_type?: 'percentage' | 'fixed' | null;
  brokerage_value?: number | string | null;
  brokerage_amount?: number | string | null;
  co_broker_payout_total?: number | string | null;
}

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** The deal's value as a number; 0 when unset. */
export function dealValue(deal: Pick<DealMoneyInput, 'value'>): number {
  return toNumber(deal.value);
}

/**
 * The brokerage's own fee on the deal, net of co-broker payouts, or
 * `null` when no brokerage has been recorded yet.
 */
export function dealFee(deal: DealMoneyInput): number | null {
  if (deal.brokerage_amount !== null && deal.brokerage_amount !== undefined) {
    return netOfPayouts(
      toNumber(deal.brokerage_amount),
      toNumber(deal.co_broker_payout_total)
    );
  }
  const gross = brokerageAmount({
    dealValue: deal.value,
    type: deal.brokerage_type,
    value: deal.brokerage_value,
  });
  if (gross <= 0) return null;
  return netOfPayouts(gross, toNumber(deal.co_broker_payout_total));
}

export interface StageTotals {
  count: number;
  value: number;
  fees: number;
  /** Deals in the stage with no brokerage recorded. */
  unpriced: number;
}

export function stageTotals(deals: readonly DealMoneyInput[]): StageTotals {
  let value = 0;
  let fees = 0;
  let unpriced = 0;
  for (const deal of deals) {
    value += dealValue(deal);
    const fee = dealFee(deal);
    if (fee === null) unpriced += 1;
    else fees += fee;
  }
  return { count: deals.length, value, fees, unpriced };
}

/**
 * One display format for every amount on the Deals surfaces: ₹8.16 Cr,
 * ₹75.05 L, ₹95,000. Other currencies render through Intl.
 */
export function formatDealAmount(
  amount: number | string | null | undefined,
  currency: string = 'INR'
): string {
  const n = toNumber(amount);
  return currency === 'INR' ? formatInrCompact(n) : formatCurrency(n, currency);
}

export const FEE_NOT_SET_LABEL = 'Fee not set';

/** `Fee ₹12 L`, `Fee not set`, or `Brokerage received ₹12 L` once paid. */
export function dealFeeLabel(
  deal: DealMoneyInput,
  options: { paid?: boolean; currency?: string } = {}
): string {
  const fee = dealFee(deal);
  if (fee === null) return FEE_NOT_SET_LABEL;
  const amount = formatDealAmount(fee, options.currency);
  return options.paid ? `Brokerage received ${amount}` : `Fee ${amount}`;
}

/**
 * The stage header under the stage name: the deals' value first, since
 * that is the number on every card, then the fees recorded so far.
 */
export function stageTotalsLabel(
  totals: StageTotals,
  options: { paid?: boolean; currency?: string } = {}
): string {
  if (totals.count === 0) return 'No deals';
  if (options.paid) {
    return `Brokerage received ${formatDealAmount(totals.fees, options.currency)}`;
  }
  const value = formatDealAmount(totals.value, options.currency);
  if (totals.fees <= 0) {
    return totals.unpriced === totals.count ? `${value} · fees not set` : value;
  }
  return `${value} · Fees ${formatDealAmount(totals.fees, options.currency)}`;
}

export interface DealCardCopyInput {
  title: string;
  contact?: { name?: string | null; phone?: string | null } | null;
  property?: { title?: string | null; unit_no?: string | null } | null;
}

export interface DealCardCopy {
  /** What the card is about: the property when it has one, else the title. */
  headline: string;
  /** The deal's own title when it says something the headline does not. */
  subline: string | null;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * A card used to print the contact and the property three times: in
 * the title ("KP Anand — East facing plot…"), in the contact row, and
 * again in a property chip. The headline is the property, the contact
 * row names the person once, and the title appears only when it adds
 * something — "Basavanagudi corner, indirect deal".
 */
export function dealCardCopy(deal: DealCardCopyInput): DealCardCopy {
  const title = clean(deal.title) ?? '';
  const unit = clean(deal.property?.unit_no);
  const property = clean(deal.property?.title);
  const headline = unit
    ? property
      ? `#${unit}, ${property}`
      : `Property No. ${unit}`
    : (property ?? title);
  if (!title) return { headline, subline: null };
  const lower = title.toLowerCase();
  const contact = clean(deal.contact?.name)?.toLowerCase() ?? null;
  const said = [headline.toLowerCase(), contact].filter(
    (part): part is string => Boolean(part)
  );
  const residual = said
    .reduce((rest, part) => rest.replace(part, ''), lower)
    .replace(/[\s—–\-·,:]+/g, ' ')
    .trim();
  if (headline === title || residual.length === 0) {
    return { headline, subline: null };
  }
  return { headline, subline: title };
}
