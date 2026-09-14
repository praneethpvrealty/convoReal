/**
 * The amount in words, the way an Indian invoice prints it.
 *
 * Not a localised number format: the grouping is crore / lakh /
 * thousand, so 1,62,00,000 reads "Sixteen Crore Twenty Lakh" and never
 * "Sixteen Million Two Hundred Thousand". `Intl` will not do this — it
 * formats digits, not words — and `priceInWords` in
 * `src/lib/currency-utils.ts` deliberately gives the short readout
 * ("₹16.2 Crore") for form hints, which is not what goes under a total.
 *
 * This is the line a bank reads when a cheque and its digits disagree,
 * so it has to be exact rather than approximate.
 */

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

/** 0–99 in words. */
function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const tens = TENS[Math.floor(n / 10)];
  const ones = ONES[n % 10];
  return ones ? `${tens} ${ones}` : tens;
}

/** 0–999 in words. */
function threeDigits(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(' ');
}

/**
 * A whole number in words, grouped the Indian way.
 *
 * Above 99,99,99,999 the grouping continues in crore ("One Thousand
 * Crore"), which is how the convention actually extends — there is no
 * larger unit in common use on an invoice.
 */
export function numberInWordsIndian(value: number): string {
  const n = Math.floor(Math.abs(value));
  if (!Number.isFinite(n)) return '';
  if (n === 0) return 'Zero';

  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;

  const parts: string[] = [];
  if (crore) {
    // Crore itself groups in the Indian style once it passes 999.
    parts.push(
      `${crore > 999 ? numberInWordsIndian(crore) : threeDigits(crore)} Crore`
    );
  }
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));

  return parts.join(' ');
}

/**
 * The full line printed under a total:
 * "Rupees Five Lakh Sixty Seven Thousand Only".
 *
 * Paise are named separately because rupees and paise are different
 * units — "Five Hundred Point Five Zero" is not what a bank accepts.
 */
export function amountInWordsIndian(
  value: number,
  currencyWord = 'Rupees',
  subUnitWord = 'Paise'
): string {
  if (!Number.isFinite(value)) return '';

  const negative = value < 0;
  const absolute = Math.abs(value);
  // Round to paise first: 0.005 must not read as zero paise while the
  // printed total shows 0.01.
  const totalPaise = Math.round(absolute * 100);
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;

  const parts: string[] = [currencyWord, numberInWordsIndian(rupees)];
  if (paise) parts.push('and', twoDigits(paise), subUnitWord);
  parts.push('Only');

  const words = parts.filter(Boolean).join(' ');
  return negative ? `Minus ${words}` : words;
}
