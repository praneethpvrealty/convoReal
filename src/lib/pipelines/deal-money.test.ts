import { describe, expect, it } from 'vitest';

import {
  dealCardCopy,
  dealFee,
  dealFeeLabel,
  FEE_NOT_SET_LABEL,
  formatDealAmount,
  stageTotals,
  stageTotalsLabel,
} from './deal-money';

describe('[PIPE-002] one fee rule for cards, stage headers and analytics', () => {
  it('uses the saved brokerage amount, net of co-broker payouts', () => {
    expect(dealFee({ value: 170000000, brokerage_amount: 1700000 })).toBe(
      1700000
    );
    expect(
      dealFee({
        value: 170000000,
        brokerage_amount: 1700000,
        co_broker_payout_total: 500000,
      })
    ).toBe(1200000);
  });

  it('applies the recorded rate when no amount is saved', () => {
    expect(
      dealFee({
        value: 81600000,
        brokerage_type: 'percentage',
        brokerage_value: 1,
      })
    ).toBe(816000);
    expect(
      dealFee({ value: 81600000, brokerage_type: 'fixed', brokerage_value: 50000 })
    ).toBe(50000);
  });

  it('never guesses a flat 2%: a deal without brokerage has no fee', () => {
    expect(dealFee({ value: 170000000 })).toBeNull();
    expect(dealFee({ value: 170000000, brokerage_value: 0 })).toBeNull();
    expect(dealFeeLabel({ value: 170000000 })).toBe(FEE_NOT_SET_LABEL);
  });

  it('keeps a saved zero as a zero fee, which is what the agent recorded', () => {
    expect(dealFee({ value: 170000000, brokerage_amount: 0 })).toBe(0);
    expect(dealFeeLabel({ value: 170000000, brokerage_amount: 0 })).toBe(
      'Fee ₹0'
    );
  });

  it('labels a paid fee as brokerage received', () => {
    expect(
      dealFeeLabel({ value: 1000000, brokerage_amount: 20000 }, { paid: true })
    ).toBe('Brokerage received ₹20,000');
  });
});

describe('[PIPE-002] the stage header leads with the number on the cards', () => {
  it('sums value and recorded fees separately', () => {
    const totals = stageTotals([
      { value: 170000000, brokerage_amount: 1700000 },
      { value: 129600000 },
    ]);
    expect(totals).toEqual({
      count: 2,
      value: 299600000,
      fees: 1700000,
      unpriced: 1,
    });
    expect(stageTotalsLabel(totals)).toBe('₹29.96 Cr · Fees ₹17 L');
  });

  it('says when no deal in the stage has a fee yet instead of printing ₹0', () => {
    const totals = stageTotals([{ value: 170000000 }, { value: 129600000 }]);
    expect(stageTotalsLabel(totals)).toBe('₹29.96 Cr · fees not set');
    expect(stageTotalsLabel(stageTotals([]))).toBe('No deals');
  });

  it('shows brokerage received on a paid stage', () => {
    const totals = stageTotals([{ value: 1000000, brokerage_amount: 20000 }]);
    expect(stageTotalsLabel(totals, { paid: true })).toBe(
      'Brokerage received ₹20,000'
    );
  });
});

describe('[PIPE-003] one amount format on every Deals surface', () => {
  it('prints Indian compact notation for rupees', () => {
    expect(formatDealAmount(81600000)).toBe('₹8.16 Cr');
    expect(formatDealAmount(7505000)).toBe('₹75.05 L');
    expect(formatDealAmount(95000)).toBe('₹95,000');
    expect(formatDealAmount(null)).toBe('₹0');
    expect(formatDealAmount('81600000')).toBe('₹8.16 Cr');
  });

  it('leaves other currencies to Intl', () => {
    expect(formatDealAmount(1500000, 'USD')).toBe('$1,500,000');
  });
});

describe('[PIPE-004] a card names the contact and the property once', () => {
  it('leads with the property and drops a title that only repeats it', () => {
    expect(
      dealCardCopy({
        title:
          'KP Anand — East facing residential plot with an old house for sale in Koramangala 3rd block.',
        contact: { name: 'KP Anand' },
        property: {
          title:
            'East facing residential plot with an old house for sale in Koramangala 3rd block.',
        },
      })
    ).toEqual({
      headline:
        'East facing residential plot with an old house for sale in Koramangala 3rd block.',
      subline: null,
    });
  });

  it('keeps a title that says something more', () => {
    expect(
      dealCardCopy({
        title: 'Basavanagudi corner Indirect deal',
        contact: { name: 'Sreenath mule' },
        property: { title: 'Corner Residential Plot' },
      })
    ).toEqual({
      headline: 'Corner Residential Plot',
      subline: 'Basavanagudi corner Indirect deal',
    });
  });

  it('prefixes the unit number and falls back to the title with no property', () => {
    expect(
      dealCardCopy({
        title: 'Sidharth — #19 JP Nagar',
        contact: { name: 'Sidharth Mahesh kumar' },
        property: { title: '2400 Sqft Commercial Plot', unit_no: '19' },
      }).headline
    ).toBe('#19, 2400 Sqft Commercial Plot');
    expect(
      dealCardCopy({ title: 'Walk-in enquiry', contact: null, property: null })
    ).toEqual({ headline: 'Walk-in enquiry', subline: null });
  });
});
