import { describe, expect, it } from 'vitest';

import { hashInvoicePdf, invoiceFilename, renderInvoicePdf } from './pdf';
import { formatIndianDigits, formatInvoiceAmount, toWinAnsi } from './pdf-text';
import { textWidth, wrapText } from './pdf-fonts';
import type { Invoice } from './types';

/** The uploaded reference invoice, as it would sit in the database. */
const REFERENCE: Invoice = {
  id: 'inv-1',
  account_id: 'acct-1',
  deal_id: 'deal-1',
  property_id: 'prop-1',
  contact_id: 'contact-1',
  party_id: null,
  invoice_number: '101/2026-27',
  financial_year: '2026-27',
  sequence_number: 101,
  invoice_date: '2026-09-08',
  status: 'issued',
  side: 'buyer',
  share_percent: 50,
  issuer: {
    legal_name: 'PriceValue Consulting',
    address_lines: [
      'No.546, 2nd Main, 1st Avenue, Teachers Colony, Koramangala, Bangalore -560034',
    ],
    rera_number: 'PRM/KA/RERA/1251/310/AG/210902/002521',
    pan: 'AMTPD9611P',
    gstin: null,
    state_code: '29',
    state_name: 'Karnataka',
    bank_account_name: 'Divya M S',
    bank_name: 'Canara Bank, HSR Layout',
    bank_account_number: '2673101011720',
    bank_ifsc: 'CNRB0002673',
    signatory_label: 'Authorised Signatory',
    gst_note:
      'Note: GST is NIL, as instructed, since the aggregate annual turnover is below Rs.20 lakhs.',
    terms: null,
  },
  bill_to: {
    name: 'Smt Pruthvi',
    address_lines: [
      'No. 268, 8th Cross, Dr H. Srinivasaiah Road',
      'Near BEML Complex, BEML Layout 3rd Stage',
      'Rajarajeshwarinagar, Bengaluru - 560098',
    ],
    gstin: null,
    pan: null,
    state_code: '29',
    state_name: 'Karnataka',
    po_number: null,
    po_date: null,
    email: null,
    phone: null,
  },
  line_items: [
    {
      sl_no: 1,
      sac: '997212',
      particulars: [
        'Real Estate Brokerage Services',
        'Purchase of Property No. 253',
        '24th Main Road, 5th Phase, J.P. Nagar',
        'Bengaluru, Karnataka - 560078',
      ],
      taxable_value: 567000,
    },
  ],
  place_of_supply: 'Karnataka',
  place_of_supply_code: '29',
  gst_mode: 'nil',
  gst_rate: 0,
  taxable_total: 567000,
  cgst: 0,
  sgst: 0,
  igst: 0,
  grand_total: 567000,
  amount_in_words: 'Rupees Five Lakh Sixty Seven Thousand Only',
  currency: 'INR',
  notes: null,
  document_hash: null,
  signature: {
    mode: 'image',
    signatory_name: 'Divya M S',
    signatory_designation: null,
    place: 'Bengaluru',
    image_path: null,
  },
  signed_at: '2026-09-08T09:30:00Z',
  issued_at: '2026-09-08T09:30:00Z',
  sent_at: null,
  paid_at: null,
  cancelled_at: null,
  cancel_reason: null,
  pdf_path: null,
  created_by: null,
  created_at: '2026-09-08T09:00:00Z',
  updated_at: '2026-09-08T09:30:00Z',
};

function asLatin1(pdf: Uint8Array): string {
  return Buffer.from(pdf).toString('latin1');
}

/**
 * Walk the cross-reference table and confirm every offset lands exactly
 * on its object header. A reader seeks by these numbers, so an off-by-one
 * here is a file that opens as a blank page — and nothing else in the
 * test suite would notice.
 */
function assertXrefIsSound(pdf: Uint8Array): number {
  const text = asLatin1(pdf);

  const startxrefAt = text.lastIndexOf('startxref');
  expect(startxrefAt).toBeGreaterThan(-1);
  const xrefOffset = Number(
    /startxref\s+(\d+)/.exec(text.slice(startxrefAt))?.[1]
  );
  expect(text.slice(xrefOffset, xrefOffset + 4)).toBe('xref');

  const header = /xref\s+0\s+(\d+)/.exec(text.slice(xrefOffset));
  expect(header).not.toBeNull();
  const size = Number(header![1]);

  const entries = [
    ...text.slice(xrefOffset).matchAll(/^(\d{10}) (\d{5}) ([nf])\s*$/gm),
  ];
  expect(entries).toHaveLength(size);

  entries.slice(1).forEach((entry, index) => {
    const offset = Number(entry[1]);
    const objectNumber = index + 1;
    expect(text.slice(offset, offset + `${objectNumber} 0 obj`.length)).toBe(
      `${objectNumber} 0 obj`
    );
  });

  return size;
}

describe('renderInvoicePdf', () => {
  it('produces a structurally valid single-page PDF', () => {
    const pdf = renderInvoicePdf(REFERENCE);
    const text = asLatin1(pdf);

    expect(text.startsWith('%PDF-1.7')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Count 1');
    expect(text).toContain('/MediaBox [0 0 595.28 841.89]');
    expect(text).toContain('/BaseFont /Helvetica');
    expect(text).toContain('/BaseFont /Helvetica-Bold');

    assertXrefIsSound(pdf);
  });

  // [INV-004] Everything the reference invoice prints has to be on the page.
  it('prints every field of the reference invoice', () => {
    const text = asLatin1(renderInvoicePdf(REFERENCE));

    for (const expected of [
      'BROKERAGE COMMISSION INVOICE',
      'PriceValue Consulting',
      'PRM/KA/RERA/1251/310/AG/210902/002521',
      'AMTPD9611P',
      '101/2026-27',
      '08/09/2026',
      'Smt Pruthvi',
      'Karnataka',
      '997212',
      'Real Estate Brokerage Services',
      'Purchase of Property No. 253',
      '5,67,000.00',
      'Rupees Five Lakh Sixty Seven Thousand Only',
      'Canara Bank, HSR Layout',
      'CNRB0002673',
      'Authorised Signatory',
    ]) {
      expect(text).toContain(expected);
    }
  });

  it('shows the NIL rows and the exemption note when GST is nil', () => {
    const text = asLatin1(renderInvoicePdf(REFERENCE));
    expect(text).toContain('IGST @ NIL');
    expect(text).toContain('SGST @ NIL');
    expect(text).toContain('CGST @ NIL');
    expect(text).toContain('below Rs.20 lakhs');
  });

  it('shows real rates and splits when the account charges GST', () => {
    const text = asLatin1(
      renderInvoicePdf({
        ...REFERENCE,
        gst_mode: 'intra',
        gst_rate: 18,
        cgst: 51030,
        sgst: 51030,
        igst: 0,
        grand_total: 669060,
        issuer: { ...REFERENCE.issuer, gst_note: null },
      })
    );
    expect(text).toContain('CGST @ 9%');
    expect(text).toContain('SGST @ 9%');
    expect(text).toContain('6,69,060.00');
  });

  // [INV-002] Re-rendering a frozen snapshot must produce identical bytes,
  // or document_hash would be meaningless as tamper evidence.
  it('is byte-identical across renders of the same invoice', () => {
    const first = renderInvoicePdf(REFERENCE);
    const second = renderInvoicePdf(REFERENCE);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    expect(hashInvoicePdf(first)).toBe(hashInvoicePdf(second));
  });

  it('hashes differently when any printed value changes', () => {
    const original = hashInvoicePdf(renderInvoicePdf(REFERENCE));
    const tampered = hashInvoicePdf(
      renderInvoicePdf({ ...REFERENCE, grand_total: 567001 })
    );
    expect(tampered).not.toBe(original);
  });

  it('renders a draft with no number without breaking', () => {
    const pdf = renderInvoicePdf({
      ...REFERENCE,
      status: 'draft',
      invoice_number: null,
      sequence_number: null,
      signature: null,
      signed_at: null,
    });
    expect(asLatin1(pdf)).toContain('DRAFT');
    expect(asLatin1(pdf)).toContain('This is a computer-generated invoice.');
    assertXrefIsSound(pdf);
  });

  it('survives an invoice with almost nothing filled in', () => {
    const pdf = renderInvoicePdf({
      ...REFERENCE,
      issuer: { legal_name: '', address_lines: [] },
      bill_to: { name: '', address_lines: [] },
      line_items: [],
      amount_in_words: null,
      signature: null,
      taxable_total: 0,
      grand_total: 0,
    });
    assertXrefIsSound(pdf);
  });

  it('escapes brackets in an address instead of corrupting the file', () => {
    const pdf = renderInvoicePdf({
      ...REFERENCE,
      bill_to: {
        ...REFERENCE.bill_to,
        name: 'Ravi (HUF) \\ Co.',
      },
    });
    expect(asLatin1(pdf)).toContain('Ravi \\(HUF\\) \\\\ Co.');
    assertXrefIsSound(pdf);
  });
});

describe('signature field', () => {
  it('reserves no field for an image signature', () => {
    const text = asLatin1(
      renderInvoicePdf(REFERENCE, { reserveSignatureField: true })
    );
    expect(text).not.toContain('/Type /Sig');
    expect(text).not.toContain('/AcroForm');
  });

  // The PAdES seam: a DSC or eSign provider injects into this placeholder
  // without the document being re-laid out.
  it('reserves a PAdES field with a patched ByteRange for a DSC', () => {
    const pdf = renderInvoicePdf(
      {
        ...REFERENCE,
        signature: { ...REFERENCE.signature!, mode: 'dsc' },
      },
      { reserveSignatureField: true }
    );
    const text = asLatin1(pdf);

    expect(text).toContain('/AcroForm');
    expect(text).toContain('/SigFlags 3');
    expect(text).toContain('/Type /Sig');
    expect(text).toContain('/SubFilter /ETSI.CAdES.detached');
    expect(text).not.toContain('**********');

    const byteRange = /\/ByteRange \[(\d+) (\d+) (\d+) (\d+)/.exec(text);
    expect(byteRange).not.toBeNull();
    const [, start, hexStart, hexEnd, tailLength] = byteRange!.map(Number);

    expect(start).toBe(0);
    // The two ranges must cover the whole file except the hex string.
    expect(hexEnd + tailLength).toBe(pdf.length);
    expect(text[hexStart]).toBe('<');
    expect(text[hexEnd - 1]).toBe('>');
    // Room for a CMS blob with its certificate chain.
    expect(hexEnd - hexStart).toBeGreaterThan(16000);

    assertXrefIsSound(pdf);
  });

  it('embeds a signature image as a JPEG XObject', () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0xff, 0xd9,
    ]);
    const pdf = renderInvoicePdf(REFERENCE, {
      signatureImage: { data: jpeg, width: 300, height: 100 },
    });
    const text = asLatin1(pdf);
    expect(text).toContain('/Subtype /Image');
    expect(text).toContain('/Filter /DCTDecode');
    expect(text).toContain('/XObject << /Im1');
    expect(text).toContain('/Im1 Do');
    assertXrefIsSound(pdf);
  });
});

describe('invoiceFilename', () => {
  it('names the file so a customer recognises it in a chat', () => {
    expect(invoiceFilename(REFERENCE)).toBe(
      'Invoice-101-2026-27-Smt-Pruthvi.pdf'
    );
  });

  it('falls back when there is no customer name', () => {
    expect(
      invoiceFilename({
        ...REFERENCE,
        bill_to: { name: '', address_lines: [] },
      })
    ).toBe('Invoice-101-2026-27.pdf');
  });
});

describe('pdf text helpers', () => {
  it('groups digits the Indian way', () => {
    expect(formatIndianDigits(567000)).toBe('5,67,000.00');
    expect(formatIndianDigits(162000000)).toBe('16,20,00,000.00');
    expect(formatIndianDigits(999)).toBe('999.00');
    expect(formatIndianDigits(1000, 0)).toBe('1,000');
    expect(formatIndianDigits(-5000)).toBe('-5,000.00');
  });

  it('writes the rupee as Rs. because WinAnsi has no rupee sign', () => {
    expect(formatInvoiceAmount(567000)).toBe('Rs. 5,67,000.00');
    expect(toWinAnsi('₹5,67,000')).toBe('Rs.5,67,000');
  });

  it('transliterates smart punctuation rather than blanking it', () => {
    expect(toWinAnsi('Owner’s plot — “as is”')).toBe('Owner\'s plot - "as is"');
  });

  it('replaces anything still unprintable with a visible gap', () => {
    expect(toWinAnsi('Bengalūru 香港')).toBe('Bengal ru');
  });
});

describe('text measurement', () => {
  it('measures a string in points', () => {
    // Helvetica digits are a uniform 556/1000 em.
    expect(textWidth('12345', 'regular', 10)).toBeCloseTo(27.8, 5);
    expect(textWidth('', 'regular', 10)).toBe(0);
  });

  it('wraps on word boundaries within the width', () => {
    const lines = wrapText(
      'No.546, 2nd Main, 1st Avenue, Teachers Colony, Koramangala',
      'regular',
      8.5,
      120
    );
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(textWidth(line, 'regular', 8.5)).toBeLessThanOrEqual(120);
    }
  });

  it('breaks a single over-long token rather than overflowing the column', () => {
    const lines = wrapText(
      'PRM/KA/RERA/1251/310/AG/210902/002521',
      'regular',
      8.5,
      60
    );
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(textWidth(line, 'regular', 8.5)).toBeLessThanOrEqual(60);
    }
  });

  it('returns nothing for empty input', () => {
    expect(wrapText('', 'regular', 9, 100)).toEqual([]);
    expect(wrapText('   ', 'regular', 9, 100)).toEqual([]);
  });
});
