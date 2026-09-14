import { describe, expect, it } from 'vitest';

import {
  computeTax,
  isIntraState,
  normaliseStateCode,
  stateCodeForName,
  stateNameForCode,
  taxableTotal,
} from './gst';

describe('computeTax', () => {
  // [INV-003] The reference invoice: NIL GST, grand total equals the brokerage.
  it('charges nothing in nil mode and passes the taxable through', () => {
    const result = computeTax({
      taxableTotal: 567000,
      gstMode: 'nil',
      gstRate: 0,
    });
    expect(result).toMatchObject({
      cgst: 0,
      sgst: 0,
      igst: 0,
      gstTotal: 0,
      grandTotal: 567000,
      appliedMode: 'nil',
    });
  });

  it('ignores a rate left behind on a nil-mode account', () => {
    const result = computeTax({
      taxableTotal: 567000,
      gstMode: 'nil',
      gstRate: 18,
      supplierStateCode: '29',
      placeOfSupplyCode: '29',
    });
    expect(result.gstTotal).toBe(0);
    expect(result.grandTotal).toBe(567000);
  });

  // [INV-003]
  it('splits the rate into CGST and SGST within one state', () => {
    const result = computeTax({
      taxableTotal: 567000,
      gstMode: 'intra',
      gstRate: 18,
      supplierStateCode: '29',
      placeOfSupplyCode: '29',
    });
    expect(result.cgst).toBe(51030);
    expect(result.sgst).toBe(51030);
    expect(result.igst).toBe(0);
    expect(result.gstTotal).toBe(102060);
    expect(result.grandTotal).toBe(669060);
    expect(result.appliedMode).toBe('intra');
  });

  // [INV-003]
  it('charges the whole rate as IGST across states', () => {
    const result = computeTax({
      taxableTotal: 567000,
      gstMode: 'inter',
      gstRate: 18,
      supplierStateCode: '29',
      placeOfSupplyCode: '27',
    });
    expect(result.cgst).toBe(0);
    expect(result.sgst).toBe(0);
    expect(result.igst).toBe(102060);
    expect(result.grandTotal).toBe(669060);
    expect(result.appliedMode).toBe('inter');
  });

  // The state codes are the statutory test, so they win over a stale
  // mode left on the settings row.
  it('lets the state codes correct a stale stored mode', () => {
    expect(
      computeTax({
        taxableTotal: 100000,
        gstMode: 'inter',
        gstRate: 18,
        supplierStateCode: '29',
        placeOfSupplyCode: '29',
      }).appliedMode
    ).toBe('intra');

    expect(
      computeTax({
        taxableTotal: 100000,
        gstMode: 'intra',
        gstRate: 18,
        supplierStateCode: '29',
        placeOfSupplyCode: '07',
      }).appliedMode
    ).toBe('inter');
  });

  it('falls back to the stored mode when a state code is unknown', () => {
    expect(
      computeTax({
        taxableTotal: 100000,
        gstMode: 'intra',
        gstRate: 18,
        supplierStateCode: '29',
        placeOfSupplyCode: null,
      }).appliedMode
    ).toBe('intra');
  });

  it('keeps CGST and SGST equal on an odd split', () => {
    const result = computeTax({
      taxableTotal: 1001,
      gstMode: 'intra',
      gstRate: 5,
    });
    expect(result.cgst).toBe(result.sgst);
    expect(result.gstTotal).toBe(result.cgst + result.sgst);
    expect(result.grandTotal).toBe(1001 + result.gstTotal);
  });

  it('treats a negative taxable value as zero', () => {
    expect(
      computeTax({ taxableTotal: -5000, gstMode: 'intra', gstRate: 18 })
        .grandTotal
    ).toBe(0);
  });
});

describe('state codes', () => {
  it('does not call a supply intra-state when the place is unknown', () => {
    expect(isIntraState('29', null)).toBe(false);
    expect(isIntraState('29', '')).toBe(false);
    expect(isIntraState(null, '29')).toBe(false);
  });

  it('treats 9, 09 and " 09 " as the same state', () => {
    expect(normaliseStateCode('9')).toBe('09');
    expect(normaliseStateCode(' 09 ')).toBe('09');
    expect(normaliseStateCode(9)).toBe('09');
    expect(isIntraState('9', '09')).toBe(true);
  });

  it('maps Karnataka to 29 both ways', () => {
    expect(stateNameForCode('29')).toBe('Karnataka');
    expect(stateCodeForName('Karnataka')).toBe('29');
    expect(stateCodeForName('karnataka')).toBe('29');
  });

  it('returns empty for an unknown code or name', () => {
    expect(stateNameForCode('99')).toBe('');
    expect(stateCodeForName('Atlantis')).toBe('');
    expect(stateNameForCode(null)).toBe('');
  });
});

describe('taxableTotal', () => {
  it('sums line items to the paise', () => {
    expect(
      taxableTotal([{ taxable_value: 567000 }, { taxable_value: 12500.5 }])
    ).toBe(579500.5);
  });

  it('ignores a line with a non-numeric value', () => {
    expect(
      taxableTotal([{ taxable_value: 567000 }, { taxable_value: Number.NaN }])
    ).toBe(567000);
  });

  it('is zero for no lines', () => {
    expect(taxableTotal([])).toBe(0);
  });
});
