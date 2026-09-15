/**
 * Tax on a brokerage invoice.
 *
 * Which tax applies is a question about geography, not about the
 * customer: a supply is intra-state when the place of supply is the
 * supplier's own state, and inter-state when it is not. Intra-state
 * splits the rate down the middle into CGST and SGST; inter-state
 * charges the whole rate as IGST. Getting this backwards is the classic
 * GST filing error, so the decision lives here rather than in a form.
 *
 * `nil` is a third case and not a zero rate: a brokerage below the
 * registration threshold is not charging tax at all, and prints why.
 */

export type GstMode = 'nil' | 'intra' | 'inter';

export interface TaxInput {
  taxableTotal: number;
  gstMode: GstMode;
  /** Whole-percent rate, e.g. 18 for 18% GST. Ignored when mode is 'nil'. */
  gstRate: number;
  /** GST state code of the supplier, e.g. '29' for Karnataka. */
  supplierStateCode?: string | null;
  /** GST state code of the place of supply. */
  placeOfSupplyCode?: string | null;
}

export interface TaxResult {
  cgst: number;
  sgst: number;
  igst: number;
  gstTotal: number;
  grandTotal: number;
  /** What the mode resolved to once the state codes were compared. */
  appliedMode: GstMode;
}

function roundPaise(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Whether a supply is intra-state.
 *
 * Only ever true when BOTH codes are known. An unknown place of supply
 * must not be assumed to be home: guessing intra-state splits tax into
 * CGST+SGST that was owed as IGST, which is a correction the supplier
 * has to file, whereas the opposite error is visible on the invoice.
 */
export function isIntraState(
  supplierStateCode: string | null | undefined,
  placeOfSupplyCode: string | null | undefined
): boolean {
  const supplier = normaliseStateCode(supplierStateCode);
  const place = normaliseStateCode(placeOfSupplyCode);
  if (!supplier || !place) return false;
  return supplier === place;
}

/** '29', '9' and '09' are the same state; blanks are unknown. */
export function normaliseStateCode(
  code: string | number | null | undefined
): string {
  if (code === null || code === undefined) return '';
  const digits = String(code).trim().replace(/\D/g, '');
  if (!digits) return '';
  return String(Number(digits)).padStart(2, '0');
}

export function computeTax(input: TaxInput): TaxResult {
  const taxable = Number.isFinite(input.taxableTotal)
    ? Math.max(input.taxableTotal, 0)
    : 0;

  if (input.gstMode === 'nil') {
    return {
      cgst: 0,
      sgst: 0,
      igst: 0,
      gstTotal: 0,
      grandTotal: roundPaise(taxable),
      appliedMode: 'nil',
    };
  }

  const rate = Number.isFinite(input.gstRate) ? Math.max(input.gstRate, 0) : 0;

  // The stored mode says the account charges GST; the state codes say
  // which kind. When both codes are known they decide, because they are
  // the statutory test.
  const bothCodesKnown =
    Boolean(normaliseStateCode(input.supplierStateCode)) &&
    Boolean(normaliseStateCode(input.placeOfSupplyCode));
  const appliedMode: GstMode = bothCodesKnown
    ? isIntraState(input.supplierStateCode, input.placeOfSupplyCode)
      ? 'intra'
      : 'inter'
    : input.gstMode;

  if (appliedMode === 'intra') {
    const half = roundPaise((taxable * rate) / 200);
    const gstTotal = roundPaise(half * 2);
    return {
      cgst: half,
      sgst: half,
      igst: 0,
      gstTotal,
      grandTotal: roundPaise(taxable + gstTotal),
      appliedMode: 'intra',
    };
  }

  const igst = roundPaise((taxable * rate) / 100);
  return {
    cgst: 0,
    sgst: 0,
    igst,
    gstTotal: igst,
    grandTotal: roundPaise(taxable + igst),
    appliedMode: 'inter',
  };
}

/** Sum of the line items, to the paise. */
export function taxableTotal(
  lineItems: Array<{ taxable_value: number }>
): number {
  return roundPaise(
    lineItems.reduce(
      (sum, item) =>
        sum + (Number.isFinite(item.taxable_value) ? item.taxable_value : 0),
      0
    )
  );
}

/**
 * GST state codes, for the place-of-supply picker. The code is what the
 * law keys on; the name is what the invoice prints.
 */
export const GST_STATE_CODES: ReadonlyArray<{ code: string; name: string }> = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
  { code: '97', name: 'Other Territory' },
];

export function stateNameForCode(code: string | null | undefined): string {
  const normalised = normaliseStateCode(code);
  return GST_STATE_CODES.find((s) => s.code === normalised)?.name ?? '';
}

export function stateCodeForName(name: string | null | undefined): string {
  const target = (name ?? '').trim().toLowerCase();
  if (!target) return '';
  return (
    GST_STATE_CODES.find((s) => s.name.toLowerCase() === target)?.code ?? ''
  );
}
