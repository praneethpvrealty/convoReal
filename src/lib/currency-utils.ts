import {
  DollarSign,
  Euro,
  PoundSterling,
  IndianRupee,
  Coins,
} from 'lucide-react';

export function getCurrencyIcon(currency: string) {
  switch (currency) {
    case 'INR':
      return IndianRupee;
    case 'USD':
      return DollarSign;
    case 'EUR':
      return Euro;
    case 'GBP':
      return PoundSterling;
    default:
      return Coins;
  }
}

export function formatCurrency(value: number, currency: string = "INR"): string {
  if (currency === "INR") {
    if (value >= 10000000) {
      const cr = value / 10000000;
      return `₹${cr.toFixed(2).replace(/\.00$/, '')} Cr`;
    } else if (value >= 100000) {
      const lakhs = value / 100000;
      return `₹${lakhs.toFixed(2).replace(/\.00$/, '')} Lakhs`;
    }
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AED: 'د.إ',
};

/**
 * An amount the way an agent says it out loud: "₹16 Crore", "₹85 Lakhs",
 * "₹45,000".
 *
 * Every price in this product is typed as digits — 160000000 — and nobody
 * can read that at a glance, so a field without this readout is a field
 * where a typo costs a zero. Four copies of this had accumulated (twice
 * as `getEquivalentPriceLabel`, twice as `formatPriceLabel`) and each had
 * reached only some of its own form's inputs; this is the one they all
 * call now.
 *
 * Returns '' for empty, non-numeric or non-positive input, which is what
 * makes it safe to render unconditionally under any amount field.
 */
export function priceInWords(
  value: string | number | null | undefined,
  currency: string = 'INR'
): string {
  if (value === null || value === undefined || value === '') return '';
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '';

  if (currency === 'INR') {
    const trim = (n: number) =>
      n.toFixed(2).replace(/\.00$/, '').replace(/\.(\d)0$/, '.$1');
    if (amount >= 10000000) return `₹${trim(amount / 10000000)} Crore`;
    if (amount >= 100000) return `₹${trim(amount / 100000)} Lakhs`;
    return `₹${amount.toLocaleString('en-IN')}`;
  }

  return `${CURRENCY_SYMBOLS[currency] ?? ''}${amount.toLocaleString()}`;
}

/** `priceInWords` as the hint under an input: "Equivalent to: ₹16 Crore". */
export function equivalentPriceLabel(
  value: string | number | null | undefined,
  currency: string = 'INR'
): string {
  const words = priceInWords(value, currency);
  return words ? `Equivalent to: ${words}` : '';
}

export function formatCurrencyShort(v: number, currency: string = 'INR'): string {
  if (currency === 'INR') {
    if (v >= 10000000) {
      const cr = v / 10000000;
      return `₹${cr.toFixed(1).replace(/\.0$/, '')} Cr`;
    }
    if (v >= 100000) {
      const lakhs = v / 100000;
      return `₹${lakhs.toFixed(1).replace(/\.0$/, '')} L`;
    }
    return `₹${v.toLocaleString('en-IN')}`;
  }

  const symbols: Record<string, string> = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    AED: 'د.إ',
  };
  const sym = symbols[currency] || '';

  if (v >= 1_000_000) return `${sym}${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${sym}${(v / 1_000).toFixed(1)}k`
  return `${sym}${v.toFixed(0)}`
}
