import { describe, expect, it } from 'vitest';

import {
  billToName,
  buildParticulars,
  buildPrefill,
  contactDisplayName,
  extractPincode,
  recalculate,
  remainingSharePercent,
  suggestSide,
  type PrefillInput,
} from './prefill';
import type { InvoiceSettings } from './types';

/** The letterhead on the uploaded reference invoice. */
const SETTINGS: InvoiceSettings = {
  id: 'settings-1',
  account_id: 'acct-1',
  legal_name: 'PriceValue Consulting',
  address_lines: [
    'No.546, 2nd Main, 1st Avenue, Teachers Colony, Koramangala, Bangalore -560034',
  ],
  rera_number: 'PRM/KA/RERA/1251/310/AG/210902/002521',
  pan: 'AMTPD9611P',
  gstin: null,
  state_code: '29',
  state_name: 'Karnataka',
  default_sac: '997212',
  default_particulars: 'Real Estate Brokerage Services',
  default_share_percent: 50,
  gst_mode: 'nil',
  gst_rate: 0,
  gst_note:
    'Note: GST is NIL, as instructed, since the aggregate annual turnover is below Rs.20 lakhs.',
  bank_account_name: 'Divya M S',
  bank_name: 'Canara Bank, HSR Layout',
  bank_account_number: '2673101011720',
  bank_ifsc: 'CNRB0002673',
  signatory_label: 'Authorised Signatory',
  terms: null,
  signature_mode: 'image',
  signature_image_path: null,
  signatory_name: 'Divya M S',
  signatory_designation: null,
  signature_place: 'Bengaluru',
  number_prefix: '',
  starting_number: 101,
  number_resets_yearly: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

/** The deal behind it: =ROUND(162000000*0.7%/2,0). */
const REFERENCE_INPUT: PrefillInput = {
  deal: {
    id: 'deal-1',
    title: 'JP Nagar — Property No. 253',
    value: 162000000,
    currency: 'INR',
    brokerage_type: 'percentage',
    brokerage_value: 0.7,
  },
  property: {
    unit_no: '253',
    location: '24th Main Road, 5th Phase, J.P. Nagar',
    city: 'Bengaluru',
    title: 'JP Nagar Independent House',
  },
  contact: { salutation: 'Mrs.', name: 'Pruthvi' },
  settings: SETTINGS,
  invoiceDate: '2026-09-08',
};

describe('buildPrefill — the uploaded reference invoice', () => {
  // [INV-004] The whole point: this invoice assembles itself.
  it('reproduces the reference invoice from the deal alone', () => {
    const result = buildPrefill(REFERENCE_INPUT);

    expect(result.taxable_total).toBe(567000);
    expect(result.grand_total).toBe(567000);
    expect(result.cgst).toBe(0);
    expect(result.sgst).toBe(0);
    expect(result.igst).toBe(0);
    expect(result.amount_in_words).toBe(
      'Rupees Five Lakh Sixty Seven Thousand Only'
    );
    expect(result.financial_year).toBe('2026-27');
    expect(result.invoice_date).toBe('2026-09-08');
    expect(result.share_percent).toBe(50);
    expect(result.side).toBe('buyer');
    expect(result.currency).toBe('INR');
  });

  it('writes the Particulars column the way the reference invoice reads', () => {
    const result = buildPrefill(REFERENCE_INPUT);
    expect(result.line_items).toHaveLength(1);
    expect(result.line_items[0].sac).toBe('997212');
    expect(result.line_items[0].taxable_value).toBe(567000);
    expect(result.line_items[0].particulars).toEqual([
      'Real Estate Brokerage Services',
      'Purchase of Property No. 253',
      '24th Main Road, 5th Phase, J.P. Nagar',
      'Bengaluru, Karnataka',
    ]);
  });

  it('carries the letterhead, RERA, PAN and bank block onto the invoice', () => {
    const { issuer } = buildPrefill(REFERENCE_INPUT);
    expect(issuer.legal_name).toBe('PriceValue Consulting');
    expect(issuer.rera_number).toBe('PRM/KA/RERA/1251/310/AG/210902/002521');
    expect(issuer.pan).toBe('AMTPD9611P');
    expect(issuer.bank_ifsc).toBe('CNRB0002673');
    expect(issuer.gst_note).toContain('below Rs.20 lakhs');
  });

  it('addresses it to the contact and supplies Karnataka as the place of supply', () => {
    const result = buildPrefill(REFERENCE_INPUT);
    expect(result.bill_to.name).toBe('Mrs. Pruthvi');
    expect(result.place_of_supply).toBe('Karnataka');
    expect(result.place_of_supply_code).toBe('29');
  });

  it('drops the GST note when the account actually charges GST', () => {
    const result = buildPrefill({
      ...REFERENCE_INPUT,
      settings: { ...SETTINGS, gst_mode: 'intra', gst_rate: 18 },
    });
    expect(result.issuer.gst_note).toBeNull();
    expect(result.cgst).toBe(51030);
    expect(result.sgst).toBe(51030);
    expect(result.grand_total).toBe(669060);
  });
});

describe('billing the other side of the same deal', () => {
  // [INV-004] The seller's half, raised after the buyer's.
  it('suggests the seller side and the unbilled remainder', () => {
    const result = buildPrefill({
      ...REFERENCE_INPUT,
      existingInvoices: [
        { side: 'buyer', share_percent: 50, status: 'issued' },
      ],
    });
    expect(result.side).toBe('seller');
    expect(result.share_percent).toBe(50);
    expect(result.taxable_total).toBe(567000);
    expect(result.line_items[0].particulars[1]).toBe(
      'Sale of Property No. 253'
    );
  });

  it('never proposes billing more of the brokerage than is left', () => {
    const result = buildPrefill({
      ...REFERENCE_INPUT,
      settings: { ...SETTINGS, default_share_percent: 100 },
      existingInvoices: [
        { side: 'buyer', share_percent: 70, status: 'issued' },
      ],
    });
    expect(result.share_percent).toBe(30);
  });

  it('frees a cancelled invoice share again', () => {
    expect(
      remainingSharePercent([
        { side: 'buyer', share_percent: 50, status: 'cancelled' },
        { side: 'seller', share_percent: 50, status: 'issued' },
      ])
    ).toBe(50);
  });

  it('stays on the buyer side when nothing has been billed', () => {
    expect(suggestSide([])).toBe('buyer');
    expect(suggestSide(null)).toBe('buyer');
  });
});

describe('who the invoice is addressed to', () => {
  it('joins a husband and wife into one addressee', () => {
    expect(
      billToName({ name: 'Pruthvi' }, [
        { salutation: 'Mr.', name: 'Ravi', second_name: 'Kumar' },
        { salutation: 'Mrs.', name: 'Pruthvi', second_name: 'Kumar' },
      ])
    ).toBe('Mr. Ravi Kumar and Mrs. Pruthvi Kumar');
  });

  it('falls back to the deal contact when there is no party', () => {
    expect(billToName({ salutation: 'Mrs.', name: 'Pruthvi' }, [])).toBe(
      'Mrs. Pruthvi'
    );
  });

  it('skips the parts of a name that are missing', () => {
    expect(contactDisplayName({ name: 'Pruthvi' })).toBe('Pruthvi');
    expect(contactDisplayName(null)).toBe('');
  });

  // [INV-002] The customer's address is typed once, then carried.
  it('carries the address forward from the last invoice to that customer', () => {
    const result = buildPrefill({
      ...REFERENCE_INPUT,
      previousInvoice: {
        bill_to: {
          name: 'Smt Pruthvi',
          address_lines: [
            'No. 268, 8th Cross, Dr H. Srinivasaiah Road',
            'Near BEML Complex, BEML Layout 3rd Stage',
            'Rajarajeshwarinagar, Bengaluru - 560098',
          ],
          gstin: null,
          state_code: '29',
          state_name: 'Karnataka',
        },
        place_of_supply: 'Karnataka',
        place_of_supply_code: '29',
      },
    });
    expect(result.bill_to.name).toBe('Smt Pruthvi');
    expect(result.bill_to.address_lines).toHaveLength(3);
    expect(result.bill_to.address_lines[0]).toContain('No. 268');
  });

  it('uses an applied identity extraction when nothing was carried forward', () => {
    const result = buildPrefill({
      ...REFERENCE_INPUT,
      extracted: {
        name: 'Pruthvi Rao',
        address_lines: ['No. 268, 8th Cross', 'Bengaluru - 560098'],
        pan: 'ABCDE1234F',
      },
    });
    // The CRM contact still names the invoice; extraction fills what the
    // CRM never held.
    expect(result.bill_to.name).toBe('Mrs. Pruthvi');
    expect(result.bill_to.address_lines).toHaveLength(2);
    expect(result.bill_to.pan).toBe('ABCDE1234F');
  });
});

describe('buildParticulars', () => {
  it('names the property by title when it has no unit number', () => {
    const lines = buildParticulars(
      SETTINGS,
      {
        title: 'Prestige Lakeside Habitat',
        location: 'Varthur',
        city: 'Bengaluru',
      },
      'buyer'
    );
    expect(lines[1]).toBe('Purchase of Prestige Lakeside Habitat');
  });

  it('falls back to the deal title when there is no property at all', () => {
    const lines = buildParticulars(SETTINGS, null, 'buyer', {
      id: 'd',
      title: 'JP Nagar plot',
    });
    expect(lines[1]).toBe('Purchase of JP Nagar plot');
  });

  it('appends a PIN code already present in the address', () => {
    const lines = buildParticulars(
      SETTINGS,
      {
        unit_no: '253',
        location: '24th Main Road, J.P. Nagar 560078',
        city: 'Bengaluru',
      },
      'buyer'
    );
    expect(lines[lines.length - 1]).toBe('Bengaluru, Karnataka - 560078');
  });

  it('emits only the service line when nothing else is known', () => {
    expect(buildParticulars(SETTINGS, null, 'buyer')).toEqual([
      'Real Estate Brokerage Services',
    ]);
  });
});

describe('extractPincode', () => {
  it('finds a six-digit PIN and ignores other numbers', () => {
    expect(extractPincode('J.P. Nagar, Bengaluru - 560078')).toBe('560078');
    expect(extractPincode('24th Main, 5th Phase')).toBe('');
    expect(extractPincode(null, '2nd Block 560034')).toBe('560034');
  });

  it('does not treat a leading zero as a PIN code', () => {
    expect(extractPincode('account 012345')).toBe('');
  });
});

describe('recalculate', () => {
  // [INV-004] A hand-edited total must never reach a customer.
  it('recomputes totals and words from the line items', () => {
    const result = recalculate({
      line_items: [
        { sl_no: 1, sac: '997212', particulars: [], taxable_value: 567000 },
        { sl_no: 2, sac: '997212', particulars: [], taxable_value: 33000 },
      ],
      gst_mode: 'nil',
      gst_rate: 0,
      issuer: { legal_name: 'x', address_lines: [], state_code: '29' },
      place_of_supply_code: '29',
    });
    expect(result.taxable_total).toBe(600000);
    expect(result.grand_total).toBe(600000);
    expect(result.amount_in_words).toBe('Rupees Six Lakh Only');
  });

  it('applies IGST when the place of supply leaves the state', () => {
    const result = recalculate({
      line_items: [
        { sl_no: 1, sac: '997212', particulars: [], taxable_value: 100000 },
      ],
      gst_mode: 'intra',
      gst_rate: 18,
      issuer: { legal_name: 'x', address_lines: [], state_code: '29' },
      place_of_supply_code: '27',
    });
    expect(result.igst).toBe(18000);
    expect(result.cgst).toBe(0);
    expect(result.grand_total).toBe(118000);
  });
});
