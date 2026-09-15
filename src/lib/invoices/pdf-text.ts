/**
 * Turning app text into something a base-14 PDF font can print.
 *
 * The built-in Helvetica is WinAnsi-encoded, which has no rupee sign —
 * so `₹5,67,000` would print as a blank or a mojibake box on a document
 * a customer is being asked to pay. `Rs.` is what the brokerage's own
 * invoices already say, and it is unambiguous. The same applies to the
 * smart quotes and en-dashes that arrive from pasted addresses.
 */

/** Characters WinAnsi cannot show, mapped to what they mean. */
const TRANSLITERATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[₹]/g, 'Rs.'],
  [/[‘’‛]/g, "'"],
  [/[“”]/g, '"'],
  [/[–—]/g, '-'],
  [/[…]/g, '...'],
  [/[   ]/g, ' '],
  [/[•]/g, '-'],
];

/**
 * Reduce a string to printable WinAnsi.
 *
 * Anything still unprintable after transliteration becomes a space
 * rather than being dropped: losing a character silently changes what
 * an address says, while a gap is visible to whoever proofreads it.
 */
export function toWinAnsi(value: string | null | undefined): string {
  let text = String(value ?? '');
  for (const [pattern, replacement] of TRANSLITERATIONS) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+$/g, '');
}

/**
 * Escape a string for a PDF literal.
 *
 * `(`, `)` and `\` terminate or escape a string object, so an address
 * reading "Plot 4 (rear)" would otherwise close the string early and
 * corrupt every object offset after it.
 */
export function escapePdfText(value: string | null | undefined): string {
  return toWinAnsi(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * `5,67,000.00` — Indian digit grouping.
 *
 * The last three digits group together and everything above them groups
 * in twos, so 5,67,000 is right and 567,000 is not. `toLocaleString`
 * with `en-IN` does this, but its availability depends on the runtime's
 * ICU build; the grouping is done here so the invoice cannot silently
 * fall back to Western grouping on a server with a small ICU.
 */
export function formatIndianDigits(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '';
  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(decimals);
  const [whole, fraction] = fixed.split('.');

  let grouped: string;
  if (whole.length <= 3) {
    grouped = whole;
  } else {
    const lastThree = whole.slice(-3);
    const rest = whole.slice(0, -3);
    grouped = `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}`;
  }

  const out = fraction ? `${grouped}.${fraction}` : grouped;
  return negative ? `-${out}` : out;
}

/** `Rs. 5,67,000.00`, the amount as it appears in a total column. */
export function formatInvoiceAmount(
  value: number,
  currency = 'INR',
  decimals = 2
): string {
  const digits = formatIndianDigits(value, decimals);
  if (!digits) return '';
  return currency === 'INR' ? `Rs. ${digits}` : `${currency} ${digits}`;
}
