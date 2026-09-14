import { describe, expect, it } from 'vitest';

import { brokerageAmount, brokerageShare, invoiceShare } from './brokerage';

describe('brokerageAmount', () => {
  it('takes a percentage of the deal value', () => {
    expect(
      brokerageAmount({ dealValue: 162000000, type: 'percentage', value: 0.7 })
    ).toBe(1134000);
  });

  it('returns a fixed fee regardless of deal value', () => {
    expect(
      brokerageAmount({ dealValue: 162000000, type: 'fixed', value: 250000 })
    ).toBe(250000);
  });

  it('parses the string values the forms hold in state', () => {
    expect(
      brokerageAmount({
        dealValue: '162000000',
        type: 'percentage',
        value: '0.7',
      })
    ).toBe(1134000);
  });

  it('is zero when no rate has been entered yet', () => {
    expect(
      brokerageAmount({ dealValue: 162000000, type: 'percentage', value: '' })
    ).toBe(0);
    expect(
      brokerageAmount({ dealValue: 162000000, type: null, value: null })
    ).toBe(0);
  });

  it('does not round, so the share can round once', () => {
    expect(
      brokerageAmount({ dealValue: 1000001, type: 'percentage', value: 1 })
    ).toBeCloseTo(10000.01, 6);
  });
});

describe('invoiceShare', () => {
  // [INV-004] The reference invoice: ROUND(162000000*0.7%/2, 0).
  it('bills half a split brokerage, rounded to the rupee', () => {
    expect(invoiceShare(1134000, 50)).toBe(567000);
  });

  it('bills the whole brokerage when one side pays it all', () => {
    expect(invoiceShare(1134000, 100)).toBe(1134000);
  });

  it('rounds to the nearest rupee rather than truncating', () => {
    expect(invoiceShare(10000.01, 50)).toBe(5000);
    expect(invoiceShare(1001, 50)).toBe(501);
  });

  it('never bills more than the whole brokerage', () => {
    expect(invoiceShare(1134000, 150)).toBe(1134000);
  });

  it('is zero for a missing or non-positive share', () => {
    expect(invoiceShare(1134000, 0)).toBe(0);
    expect(invoiceShare(1134000, null)).toBe(0);
    expect(invoiceShare(0, 50)).toBe(0);
  });
});

describe('brokerageShare', () => {
  // [INV-004] The end-to-end figure printed on the reference invoice.
  it('reproduces the reference invoice from the deal', () => {
    expect(
      brokerageShare(
        { dealValue: 162000000, type: 'percentage', value: 0.7 },
        50
      )
    ).toBe(567000);
  });

  it('gives each side of a 50/50 split a half that sums to the whole', () => {
    const input = {
      dealValue: 162000000,
      type: 'percentage' as const,
      value: 0.7,
    };
    const buyer = brokerageShare(input, 50);
    const seller = brokerageShare(input, 50);
    expect(buyer + seller).toBe(brokerageAmount(input));
  });
});
