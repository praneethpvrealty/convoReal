export const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AED: 'د.إ',
};

const CRORE = 10_000_000;
const LAKH = 100_000;

function trimZeros(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * Indian grouping with no scale word: ₹12,34,567. Whole rupees by
 * default; pass `fractionDigits` for an amount whose paise matter,
 * such as a cost per lead, and only the digits present are shown.
 */
export function formatInrPlain(amount: number, fractionDigits = 0): string {
  if (fractionDigits === 0) {
    return `₹${Math.round(amount).toLocaleString('en-IN')}`;
  }
  return `₹${amount.toLocaleString('en-IN', {
    maximumFractionDigits: fractionDigits,
  })}`;
}

/**
 * The abbreviated form for dense lists, cards, digests and bot replies:
 * ₹1.25 Cr, ₹1.5 L, ₹95,000. Trailing zeros are dropped, so ₹1.50 L
 * never appears; a negative amount keeps its sign.
 */
export function formatInrCompact(amount: number): string {
  const value = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (value >= CRORE) return `${sign}₹${trimZeros(value / CRORE)} Cr`;
  if (value >= LAKH) return `${sign}₹${trimZeros(value / LAKH)} L`;
  return `${sign}${formatInrPlain(value)}`;
}

/**
 * The listing-price form on inventory cards, flyers, the showcase and
 * outgoing WhatsApp listing messages: ₹1.25 Cr, ₹2.50 Lakhs, ₹95,000,
 * with two decimals kept unless they are both zero. Other currencies
 * render through Intl in the en-US locale.
 */
export function formatCurrency(
  value: number,
  currency: string = 'INR'
): string {
  if (currency === 'INR') {
    if (value >= CRORE) {
      const cr = value / CRORE;
      return `₹${cr.toFixed(2).replace(/\.00$/, '')} Cr`;
    } else if (value >= LAKH) {
      const lakhs = value / LAKH;
      return `₹${lakhs.toFixed(2).replace(/\.00$/, '')} Lakhs`;
    }
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

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
      n
        .toFixed(2)
        .replace(/\.00$/, '')
        .replace(/\.(\d)0$/, '.$1');
    if (amount >= CRORE) return `₹${trim(amount / CRORE)} Crore`;
    if (amount >= LAKH) return `₹${trim(amount / LAKH)} Lakhs`;
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

export function formatCurrencyShort(
  v: number,
  currency: string = 'INR'
): string {
  if (currency === 'INR') {
    if (v >= CRORE) {
      const cr = v / CRORE;
      return `₹${cr.toFixed(1).replace(/\.0$/, '')} Cr`;
    }
    if (v >= LAKH) {
      const lakhs = v / LAKH;
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

  if (v >= 1_000_000) return `${sym}${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${sym}${(v / 1_000).toFixed(1)}k`;
  return `${sym}${v.toFixed(0)}`;
}
