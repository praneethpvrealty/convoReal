/**
 * The invoice, laid out on a page.
 *
 * A deliberate copy of the workbook this replaces, because the people
 * who receive it — buyers, sellers, and the brokerage's own CA — already
 * know what that document looks like, and an invoice that arrives
 * looking unfamiliar gets queried instead of paid.
 *
 * The layout is top-down here and bottom-up in PDF coordinates, so a
 * single `cursor` counts down from the top of the page and `at()` flips
 * it once at the point of drawing.
 */

import { createHash } from 'node:crypto';

import { formatInvoiceDate } from './financial-year';
import { textWidth, wrapText } from './pdf-fonts';
import { formatIndianDigits } from './pdf-text';
import {
  A4_HEIGHT,
  A4_WIDTH,
  buildPdf,
  PdfPage,
  type JpegImage,
} from './pdf-writer';
import type { Invoice } from './types';

const MARGIN = 40;
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;
const RIGHT = A4_WIDTH - MARGIN;

/** Item table column boundaries, from the left margin. */
const COL_SL = MARGIN;
const COL_SAC = MARGIN + 38;
const COL_PARTICULARS = MARGIN + 96;
const COL_AMOUNT_END = RIGHT;
const COL_AMOUNT_START = RIGHT - 110;

export interface RenderInvoiceOptions {
  /** The scanned signature, pre-converted to JPEG by the caller —
   *  `sharp` does that server-side so this module stays dependency-free. */
  signatureImage?: JpegImage | null;
  /** Reserve a PAdES signature field for a DSC or Aadhaar eSign step.
   *  Left off for an image signature, because an unfilled field makes a
   *  reader announce an invalid signature on a document nobody signed. */
  reserveSignatureField?: boolean;
}

export function renderInvoicePdf(
  invoice: Invoice,
  options: RenderInvoiceOptions = {}
): Uint8Array {
  const page = new PdfPage();
  const issuer = invoice.issuer ?? { legal_name: '', address_lines: [] };
  const billTo = invoice.bill_to ?? { name: '', address_lines: [] };

  /** Top-down cursor to PDF's bottom-up y. */
  let cursor = MARGIN;
  const at = () => A4_HEIGHT - cursor;
  const down = (amount: number) => {
    cursor += amount;
  };

  // ---- Letterhead -------------------------------------------------
  down(14);
  page.text('BROKERAGE COMMISSION INVOICE', A4_WIDTH / 2, at(), {
    font: 'bold',
    size: 14,
    align: 'center',
  });

  down(20);
  page.text(issuer.legal_name ?? '', A4_WIDTH / 2, at(), {
    font: 'bold',
    size: 12,
    align: 'center',
  });

  for (const line of issuer.address_lines ?? []) {
    for (const wrapped of wrapText(line, 'regular', 8.5, CONTENT_WIDTH)) {
      down(12);
      page.text(wrapped, A4_WIDTH / 2, at(), { size: 8.5, align: 'center' });
    }
  }

  down(14);
  page.line(MARGIN, at(), RIGHT, at(), 1);

  // ---- Identity: issuer on the left, invoice on the right ---------
  down(6);
  const identityTop = cursor;

  const labelX = MARGIN + 4;
  const valueX = MARGIN + 80;
  const rightLabelX = MARGIN + 290;
  const rightValueX = MARGIN + 375;
  const leftValueWidth = rightLabelX - valueX - 10;
  const rightValueWidth = RIGHT - rightValueX - 4;

  const leftRows: Array<[string, string]> = [];
  if (issuer.rera_number) leftRows.push(['RERA No.', issuer.rera_number]);
  if (issuer.pan) leftRows.push(['PAN', issuer.pan]);
  if (issuer.gstin) leftRows.push(['GSTIN', issuer.gstin]);

  const rightRows: Array<[string, string]> = [
    ['Invoice No.', invoice.invoice_number ?? 'DRAFT'],
    ['Invoice Date', formatInvoiceDate(invoice.invoice_date)],
  ];

  const identityRows = Math.max(leftRows.length, rightRows.length);
  for (let i = 0; i < identityRows; i += 1) {
    down(13);
    const y = at();
    if (leftRows[i]) {
      page.text(leftRows[i][0], labelX, y, { size: 8.5, font: 'bold' });
      const [firstLine] = wrapText(
        leftRows[i][1],
        'regular',
        8.5,
        leftValueWidth
      );
      page.text(firstLine ?? leftRows[i][1], valueX, y, { size: 8.5 });
    }
    if (rightRows[i]) {
      page.text(rightRows[i][0], rightLabelX, y, { size: 8.5, font: 'bold' });
      page.text(rightRows[i][1], rightValueX, y, { size: 8.5 });
    }
  }

  down(8);
  page.rect(MARGIN, at(), CONTENT_WIDTH, cursor - identityTop + 2);

  // ---- Customer block --------------------------------------------
  down(8);
  const customerTop = cursor;

  const customerRight: Array<[string, string]> = [
    ['Customer PO #', billTo.po_number || 'NA'],
    ['Customer PO Date', billTo.po_date || 'NA'],
    ['Customer GSTIN', billTo.gstin || 'NA'],
    ['State Code', billTo.state_code || invoice.place_of_supply_code || 'NA'],
    ['Place of Supply', invoice.place_of_supply || 'NA'],
  ];

  const addressLines = (billTo.address_lines ?? []).flatMap((line) =>
    wrapText(line, 'regular', 8.5, leftValueWidth)
  );
  const customerLeft: Array<[string, string]> = [
    ['Customer Name', billTo.name ?? ''],
    ...addressLines.map((line, index): [string, string] => [
      index === 0 ? 'Customer Address' : '',
      line,
    ]),
  ];

  const customerRows = Math.max(customerLeft.length, customerRight.length);
  for (let i = 0; i < customerRows; i += 1) {
    down(13);
    const y = at();
    if (customerLeft[i]) {
      if (customerLeft[i][0]) {
        page.text(customerLeft[i][0], labelX, y, { size: 8.5, font: 'bold' });
      }
      page.text(customerLeft[i][1], valueX, y, { size: 8.5 });
    }
    if (customerRight[i]) {
      page.text(customerRight[i][0], rightLabelX, y, {
        size: 8.5,
        font: 'bold',
      });
      const [value] = wrapText(
        customerRight[i][1],
        'regular',
        8.5,
        rightValueWidth
      );
      page.text(value ?? customerRight[i][1], rightValueX, y, { size: 8.5 });
    }
  }

  down(8);
  page.rect(MARGIN, at(), CONTENT_WIDTH, cursor - customerTop + 2);

  // ---- Item table -------------------------------------------------
  down(18);
  const tableTop = cursor;
  const headerHeight = 24;

  page.fillRect(MARGIN, at() - headerHeight + 12, CONTENT_WIDTH, headerHeight);
  page.text('Sl.No.', COL_SL + 4, at(), { size: 8.5, font: 'bold' });
  page.text('SAC', COL_SAC + 4, at(), { size: 8.5, font: 'bold' });
  page.text('Particulars', COL_PARTICULARS + 4, at(), {
    size: 8.5,
    font: 'bold',
  });
  page.text('Taxable', COL_AMOUNT_END - 4, at() + 6, {
    size: 8.5,
    font: 'bold',
    align: 'right',
  });
  page.text('Value', COL_AMOUNT_END - 4, at() - 3, {
    size: 8.5,
    font: 'bold',
    align: 'right',
  });

  down(headerHeight - 12);
  const bodyTop = cursor;

  const particularsWidth = COL_AMOUNT_START - COL_PARTICULARS - 8;
  for (const item of invoice.line_items ?? []) {
    down(15);
    const firstY = at();
    page.text(String(item.sl_no), COL_SL + 4, firstY, { size: 8.5 });
    page.text(item.sac ?? '', COL_SAC + 4, firstY, { size: 8.5 });
    page.text(
      formatIndianDigits(item.taxable_value),
      COL_AMOUNT_END - 4,
      firstY,
      { size: 8.5, align: 'right' }
    );

    const particulars = (item.particulars ?? []).flatMap((line) =>
      wrapText(line, 'regular', 8.5, particularsWidth)
    );
    particulars.forEach((line, index) => {
      if (index > 0) down(12);
      page.text(line, COL_PARTICULARS + 4, at(), {
        size: 8.5,
        font: index === 0 ? 'bold' : 'regular',
      });
    });
  }

  // Keep the table a sensible minimum height so a one-line invoice does
  // not collapse into a sliver.
  const bodyHeight = Math.max(cursor - bodyTop + 8, 70);
  cursor = bodyTop + bodyHeight;

  const tableHeight = cursor - tableTop + 12;
  const tableBottom = A4_HEIGHT - cursor;
  page.rect(MARGIN, tableBottom, CONTENT_WIDTH, tableHeight);
  for (const x of [COL_SAC, COL_PARTICULARS, COL_AMOUNT_START]) {
    page.line(x, tableBottom, x, tableBottom + tableHeight);
  }
  page.line(
    MARGIN,
    tableBottom + tableHeight - headerHeight,
    RIGHT,
    tableBottom + tableHeight - headerHeight
  );

  // ---- Totals -----------------------------------------------------
  const totalsLabelX = COL_AMOUNT_START - 6;
  const totalRows: Array<[string, number, boolean]> = [
    [invoice.place_of_supply || 'Taxable Value', invoice.taxable_total, false],
  ];

  if (invoice.gst_mode === 'nil') {
    totalRows.push(
      ['IGST @ NIL', 0, false],
      ['SGST @ NIL', 0, false],
      ['CGST @ NIL', 0, false]
    );
  } else {
    const rate = invoice.gst_rate ?? 0;
    const half = formatIndianDigits(rate / 2, rate % 2 === 0 ? 0 : 2);
    const full = formatIndianDigits(rate, rate % 1 === 0 ? 0 : 2);
    totalRows.push(
      [`IGST @ ${full}%`, invoice.igst, false],
      [`SGST @ ${half}%`, invoice.sgst, false],
      [`CGST @ ${half}%`, invoice.cgst, false]
    );
  }

  totalRows.push(
    ['GST Total', invoice.cgst + invoice.sgst + invoice.igst, false],
    ['Grand Total', invoice.grand_total, true]
  );

  for (const [label, amount, emphasised] of totalRows) {
    down(14);
    const y = at();
    page.text(label, totalsLabelX, y, {
      size: 8.5,
      align: 'right',
      font: emphasised ? 'bold' : 'regular',
    });
    page.text(formatIndianDigits(amount), COL_AMOUNT_END - 4, y, {
      size: 8.5,
      align: 'right',
      font: emphasised ? 'bold' : 'regular',
    });
  }

  down(4);
  page.line(COL_AMOUNT_START, at(), RIGHT, at(), 1);

  // ---- Amount in words --------------------------------------------
  if (invoice.amount_in_words) {
    down(18);
    const prefix = 'Amount in words: ';
    page.text(prefix, MARGIN, at(), { size: 8.5, font: 'bold' });
    const offset = textWidth(prefix, 'bold', 8.5);
    const wrapped = wrapText(
      invoice.amount_in_words,
      'regular',
      8.5,
      CONTENT_WIDTH - offset
    );
    wrapped.forEach((line, index) => {
      if (index > 0) down(11);
      page.text(line, MARGIN + (index === 0 ? offset : 0), at(), { size: 8.5 });
    });
  }

  // ---- Notes ------------------------------------------------------
  if (invoice.gst_mode === 'nil' && issuer.gst_note) {
    down(18);
    for (const line of wrapText(issuer.gst_note, 'regular', 8, CONTENT_WIDTH)) {
      page.text(line, MARGIN, at(), { size: 8 });
      down(11);
    }
    cursor -= 11;
  }

  if (invoice.notes) {
    down(16);
    for (const line of wrapText(invoice.notes, 'regular', 8, CONTENT_WIDTH)) {
      page.text(line, MARGIN, at(), { size: 8 });
      down(11);
    }
    cursor -= 11;
  }

  // ---- Bank block and signature -----------------------------------
  const bankLines: string[] = [];
  if (issuer.bank_account_name)
    bankLines.push(`Name: ${issuer.bank_account_name}`);
  if (issuer.bank_name) bankLines.push(`Name of the bank: ${issuer.bank_name}`);
  if (issuer.bank_account_number) {
    bankLines.push(`Account No.: ${issuer.bank_account_number}`);
  }
  if (issuer.bank_ifsc) bankLines.push(`IFSC code: ${issuer.bank_ifsc}`);

  down(24);
  const footerTop = cursor;

  if (bankLines.length) {
    page.text('Bank details to transfer the amount', MARGIN, at(), {
      size: 8.5,
      font: 'bold',
    });
    for (const line of bankLines) {
      down(12);
      page.text(line, MARGIN, at(), { size: 8.5 });
    }
  }

  // The signature sits opposite the bank block, at a fixed height so it
  // is in the same place whether or not an image was uploaded.
  const signature = invoice.signature;
  const signatureBlockTop = A4_HEIGHT - footerTop;
  const signatureRight = RIGHT;
  const signatureWidth = 150;
  const signatureLeft = signatureRight - signatureWidth;

  if (options.signatureImage) {
    const maxWidth = 120;
    const maxHeight = 42;
    const scale = Math.min(
      maxWidth / options.signatureImage.width,
      maxHeight / options.signatureImage.height,
      1
    );
    const drawWidth = options.signatureImage.width * scale;
    const drawHeight = options.signatureImage.height * scale;
    page.image(
      signatureRight - drawWidth,
      signatureBlockTop - drawHeight - 6,
      drawWidth,
      drawHeight
    );
  }

  const signatureLineY = signatureBlockTop - 52;
  page.line(signatureLeft, signatureLineY, signatureRight, signatureLineY, 0.5);

  let signatureTextY = signatureLineY - 11;
  if (signature?.signatory_name) {
    page.text(signature.signatory_name, signatureRight, signatureTextY, {
      size: 8.5,
      align: 'right',
      font: 'bold',
    });
    signatureTextY -= 11;
  }
  if (signature?.signatory_designation) {
    page.text(signature.signatory_designation, signatureRight, signatureTextY, {
      size: 8,
      align: 'right',
    });
    signatureTextY -= 11;
  }
  page.text(
    issuer.signatory_label || 'Authorised Signatory',
    signatureRight,
    signatureTextY,
    { size: 8.5, align: 'right' }
  );

  if (signature?.mode === 'image' && invoice.signed_at) {
    signatureTextY -= 11;
    page.text(
      `Electronically signed on ${formatInvoiceDate(invoice.signed_at)}`,
      signatureRight,
      signatureTextY,
      { size: 7, align: 'right', gray: 0.35 }
    );
  }

  // An unsigned electronic invoice has to say so: GST rule 46 waives a
  // signature only for an invoice issued under the IT Act, and a reader
  // has no way to tell a deliberately unsigned document from one whose
  // signature failed.
  if (!signature || signature.mode === 'none') {
    page.text(
      'This is a computer-generated invoice.',
      MARGIN,
      A4_HEIGHT - footerTop - 78,
      { size: 7, gray: 0.4 }
    );
  }

  const reserveField =
    options.reserveSignatureField &&
    (signature?.mode === 'dsc' || signature?.mode === 'esign');

  return buildPdf(page, {
    title: `Invoice ${invoice.invoice_number ?? 'Draft'}`,
    author: issuer.legal_name ?? '',
    subject: `Brokerage commission invoice${
      invoice.invoice_number ? ` ${invoice.invoice_number}` : ''
    }`,
    // Derived from the invoice date, so re-rendering the same frozen
    // snapshot produces the same bytes and therefore the same hash.
    creationDate: new Date(`${invoice.invoice_date}T00:00:00Z`),
    image: options.signatureImage ?? null,
    signature: reserveField
      ? {
          reason: 'Brokerage commission invoice',
          location: signature?.place ?? '',
          contactInfo: issuer.legal_name ?? '',
          rect: [
            signatureLeft,
            signatureBlockTop - 56,
            signatureRight,
            signatureBlockTop,
          ],
        }
      : null,
  });
}

/**
 * The hash frozen onto the invoice at issue.
 *
 * SHA-256 over the rendered bytes: it is what makes the stored record
 * tamper-evident, and it is exactly what a Class 3 DSC or an Aadhaar
 * eSign signs, so the same value serves both purposes.
 */
export function hashInvoicePdf(pdf: Uint8Array): string {
  return createHash('sha256').update(pdf).digest('hex');
}

/** A filename a customer can recognise in a WhatsApp thread. */
export function invoiceFilename(invoice: Invoice): string {
  const number = (invoice.invoice_number ?? 'draft').replace(/[^\w-]+/g, '-');
  const name = (invoice.bill_to?.name ?? '')
    .replace(/[^\w\s-]+/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return name ? `Invoice-${number}-${name}.pdf` : `Invoice-${number}.pdf`;
}
