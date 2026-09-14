/**
 * Indian financial years and invoice serials.
 *
 * An invoice number is only meaningful inside a financial year — GST
 * rule 46(b) asks for a serial unique within one — and India's runs
 * April to March, so a September 2026 invoice belongs to 2026-27 and a
 * February 2027 invoice belongs to the same year, not to 2027-28. A
 * calendar year here would silently restart the series in the middle of
 * the books.
 */

/** '2026-27' for any date from 1 Apr 2026 to 31 Mar 2027. */
export function financialYearFor(date: Date | string): string {
  const d = typeof date === 'string' ? parseDateOnly(date) : date;
  if (!d || Number.isNaN(d.getTime())) {
    throw new Error(`financialYearFor: invalid date "${String(date)}"`);
  }
  // getMonth() is 0-based, so March is 2 and April is 3.
  const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  const endShort = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endShort}`;
}

/**
 * Parse a date that carries no time.
 *
 * `new Date('2026-09-08')` is parsed as UTC midnight, which in any
 * timezone behind UTC is the 7th locally — so a 1 April invoice would
 * land in the previous financial year for a user in New York. Reading
 * the parts directly keeps the date meaning the day that was typed.
 */
function parseDateOnly(value: string): Date {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (dmy) {
    return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  }
  return new Date(value);
}

/** '101/2026-27', or 'PVC/101/2026-27' when the account uses a prefix. */
export function formatInvoiceNumber(
  sequenceNumber: number,
  financialYear: string,
  prefix?: string | null
): string {
  const base = `${sequenceNumber}/${financialYear}`;
  const clean = (prefix ?? '').trim().replace(/\/+$/, '');
  return clean ? `${clean}/${base}` : base;
}

/** `08/09/2026` — the day-first form every Indian invoice prints. */
export function formatInvoiceDate(date: Date | string): string {
  const d = typeof date === 'string' ? parseDateOnly(date) : date;
  if (!d || Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/** `2026-09-08` — how the date is stored and sent to the API. */
export function toDateOnly(date: Date | string): string {
  const d = typeof date === 'string' ? parseDateOnly(date) : date;
  if (!d || Number.isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
