/**
 * Building an invoice out of what the Engine already knows.
 *
 * This is the point of the feature. A brokerage invoice restates facts
 * the deal already holds — the sale value, the rate agreed, the
 * property, the buyer — and the only reason invoices are still typed
 * into a spreadsheet is that nothing ever assembled them. So the
 * default here is that an agent opens the editor and changes nothing.
 *
 * Every rule is pure and takes plain shapes rather than database rows,
 * so the same prefill runs on the server for the API, in a test without
 * a database, and produces exactly what mobile shows.
 */

import { brokerageShare, type BrokerageType } from '@/lib/pipelines/brokerage';

import { financialYearFor, toDateOnly } from './financial-year';
import {
  computeTax,
  normaliseStateCode,
  stateCodeForName,
  stateNameForCode,
  taxableTotal,
} from './gst';
import { amountInWordsIndian } from './words';
import type {
  ExtractedDocumentFields,
  InvoiceBillTo,
  InvoiceIssuer,
  InvoiceLineItem,
  InvoiceSettings,
  InvoiceSide,
} from './types';

export interface PrefillDeal {
  id: string;
  title?: string | null;
  value?: number | null;
  currency?: string | null;
  brokerage_type?: BrokerageType | null;
  brokerage_value?: number | null;
}

export interface PrefillProperty {
  title?: string | null;
  unit_no?: string | null;
  location?: string | null;
  city?: string | null;
  /** State name as stored on the property, e.g. "Karnataka". Decides
   *  the place of supply, and through it CGST+SGST versus IGST. */
  state?: string | null;
  property_code?: string | null;
}

export interface PrefillContact {
  salutation?: string | null;
  name?: string | null;
  second_name?: string | null;
  email?: string | null;
  phone?: string | null;
}

/** A prior invoice to the same customer, used to carry details forward. */
export interface PrefillPreviousInvoice {
  bill_to?: InvoiceBillTo | null;
  place_of_supply?: string | null;
  place_of_supply_code?: string | null;
}

/** Invoices already raised on this deal, to work out what is left to bill. */
export interface PrefillExistingInvoice {
  side: InvoiceSide;
  share_percent: number;
  status: string;
}

export interface PrefillInput {
  deal: PrefillDeal;
  property?: PrefillProperty | null;
  contact?: PrefillContact | null;
  /** Joint buyers — a husband and wife on one purchase get one invoice. */
  partyMembers?: PrefillContact[] | null;
  settings: InvoiceSettings;
  previousInvoice?: PrefillPreviousInvoice | null;
  existingInvoices?: PrefillExistingInvoice[] | null;
  /** Applied output of AI document extraction, if the agent accepted any. */
  extracted?: ExtractedDocumentFields | null;
  side?: InvoiceSide;
  sharePercent?: number;
  invoiceDate?: string | Date;
}

export interface PrefilledInvoice {
  invoice_date: string;
  financial_year: string;
  side: InvoiceSide;
  share_percent: number;
  issuer: InvoiceIssuer;
  bill_to: InvoiceBillTo;
  line_items: InvoiceLineItem[];
  place_of_supply: string | null;
  place_of_supply_code: string | null;
  gst_mode: InvoiceSettings['gst_mode'];
  gst_rate: number;
  taxable_total: number;
  cgst: number;
  sgst: number;
  igst: number;
  grand_total: number;
  amount_in_words: string;
  currency: string;
}

function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/** "Mrs. Pruthvi Rao", skipping whatever is missing. */
export function contactDisplayName(
  contact: PrefillContact | null | undefined
): string {
  if (!contact) return '';
  return [contact.salutation, contact.name, contact.second_name]
    .map(clean)
    .filter(Boolean)
    .join(' ');
}

/**
 * Who the invoice is addressed to.
 *
 * Joint buyers are one customer with one invoice — billing a husband
 * and wife separately for the same purchase would double the brokerage
 * on paper. `contact_parties` (migration 288) already models exactly
 * this, so the party's members become one addressee.
 */
export function billToName(
  contact: PrefillContact | null | undefined,
  partyMembers?: PrefillContact[] | null
): string {
  const members = (partyMembers ?? []).map(contactDisplayName).filter(Boolean);
  if (members.length > 1) {
    return `${members.slice(0, -1).join(', ')} and ${members[members.length - 1]}`;
  }
  return members[0] || contactDisplayName(contact);
}

/** A six-digit Indian PIN code, if one is sitting in the text already. */
export function extractPincode(
  ...values: Array<string | null | undefined>
): string {
  for (const value of values) {
    const match = /\b([1-9]\d{5})\b/.exec(clean(value));
    if (match) return match[1];
  }
  return '';
}

/**
 * The Particulars column.
 *
 * The reference invoice reads:
 *   Real Estate Brokerage Services
 *   Purchase of Property No. 253
 *   24th Main Road, 5th Phase, J.P. Nagar
 *   Bengaluru, Karnataka - 560078
 *
 * so it is the service, then what was transacted, then where. `side`
 * decides Purchase or Sale, because the same deal produces a "Purchase
 * of" invoice to the buyer and a "Sale of" invoice to the seller.
 */
export function buildParticulars(
  settings: InvoiceSettings,
  property: PrefillProperty | null | undefined,
  side: InvoiceSide,
  deal?: PrefillDeal | null
): string[] {
  const lines: string[] = [
    clean(settings.default_particulars) || 'Real Estate Brokerage Services',
  ];

  const verb = side === 'seller' ? 'Sale' : 'Purchase';
  const unit = clean(property?.unit_no);
  const subject = unit
    ? `Property No. ${unit}`
    : clean(property?.title) || clean(deal?.title);
  if (subject) lines.push(`${verb} of ${subject}`);

  const location = clean(property?.location);
  if (location) lines.push(location);

  // The property's own state, falling back to the account's only when
  // the property does not record one. Printing the supplier's state
  // under a property in another state states the wrong thing, and this
  // line is the address a buyer checks against their sale deed.
  const city = clean(property?.city);
  if (city) {
    const pincode = extractPincode(property?.location, property?.title);
    const stateName = clean(property?.state) || clean(settings.state_name);
    const tail = [city, stateName].filter(Boolean).join(', ');
    lines.push(pincode ? `${tail} - ${pincode}` : tail);
  }

  return lines;
}

/**
 * How much of the deal's brokerage is still unbilled.
 *
 * A cancelled invoice frees its share again; an issued one does not.
 * Without this, raising the seller's invoice after the buyer's would
 * default to billing the whole brokerage a second time.
 */
export function remainingSharePercent(
  existing: PrefillExistingInvoice[] | null | undefined
): number {
  const billed = (existing ?? [])
    .filter((invoice) => invoice.status !== 'cancelled')
    .reduce((sum, invoice) => sum + (Number(invoice.share_percent) || 0), 0);
  return Math.max(0, 100 - billed);
}

/** The side that has not been billed yet, when one of them has. */
export function suggestSide(
  existing: PrefillExistingInvoice[] | null | undefined
): InvoiceSide {
  const live = (existing ?? []).filter(
    (invoice) => invoice.status !== 'cancelled'
  );
  if (
    live.some((invoice) => invoice.side === 'buyer') &&
    !live.some((invoice) => invoice.side === 'seller')
  ) {
    return 'seller';
  }
  return 'buyer';
}

export function buildPrefill(input: PrefillInput): PrefilledInvoice {
  const { settings, deal, property, contact, previousInvoice, extracted } =
    input;

  const invoiceDate = toDateOnly(input.invoiceDate ?? new Date());
  const financialYear = financialYearFor(invoiceDate);

  const side = input.side ?? suggestSide(input.existingInvoices);

  // Bill the account's usual share, but never more of the brokerage
  // than is actually left to bill.
  const remaining = remainingSharePercent(input.existingInvoices);
  const preferred = Number(settings.default_share_percent) || 100;
  const sharePercent =
    input.sharePercent ??
    (remaining > 0 ? Math.min(preferred, remaining) : preferred);

  const amount = brokerageShare(
    {
      dealValue: deal.value,
      type: deal.brokerage_type ?? 'percentage',
      value: deal.brokerage_value,
    },
    sharePercent
  );

  const lineItems: InvoiceLineItem[] = [
    {
      sl_no: 1,
      sac: clean(settings.default_sac) || '997212',
      particulars: buildParticulars(settings, property, side, deal),
      taxable_value: amount,
    },
  ];

  // The customer's address is the one thing an invoice needs that a CRM
  // contact has never held. It comes, in order of confidence: from the
  // last invoice raised to this customer, then from an identity document
  // the agent explicitly applied, then blank for them to type once.
  const carried = previousInvoice?.bill_to ?? null;
  const billTo: InvoiceBillTo = {
    name:
      clean(carried?.name) ||
      billToName(contact, input.partyMembers) ||
      clean(extracted?.name),
    address_lines: carried?.address_lines?.length
      ? carried.address_lines
      : (extracted?.address_lines ?? []),
    gstin: carried?.gstin ?? null,
    pan: carried?.pan ?? extracted?.pan ?? null,
    state_code: carried?.state_code ?? null,
    state_name: carried?.state_name ?? extracted?.state_name ?? null,
    po_number: null,
    po_date: null,
    email: clean(contact?.email) || null,
    phone: clean(contact?.phone) || null,
  };

  // The supply happens where the PROPERTY is, so the property's own
  // state decides it — not the customer's last invoice, which was for a
  // different property, and not the brokerage's state, which is merely
  // where most of its listings happen to be. Getting this wrong bills
  // CGST+SGST on a supply that owed IGST, which is a correction the
  // supplier has to file.
  const propertyStateCode = stateCodeForName(property?.state);
  const placeCode = normaliseStateCode(
    propertyStateCode ||
      previousInvoice?.place_of_supply_code ||
      settings.state_code
  );
  const placeName =
    stateNameForCode(placeCode) ||
    clean(property?.state) ||
    clean(previousInvoice?.place_of_supply) ||
    clean(settings.state_name);

  const total = taxableTotal(lineItems);
  const tax = computeTax({
    taxableTotal: total,
    gstMode: settings.gst_mode,
    gstRate: Number(settings.gst_rate) || 0,
    supplierStateCode: settings.state_code,
    placeOfSupplyCode: placeCode,
  });

  const issuer: InvoiceIssuer = {
    legal_name: clean(settings.legal_name),
    address_lines: settings.address_lines ?? [],
    rera_number: settings.rera_number,
    pan: settings.pan,
    gstin: settings.gstin,
    state_code: settings.state_code,
    state_name: settings.state_name,
    bank_account_name: settings.bank_account_name,
    bank_name: settings.bank_name,
    bank_account_number: settings.bank_account_number,
    bank_ifsc: settings.bank_ifsc,
    signatory_label: settings.signatory_label,
    gst_note: settings.gst_note,
    terms: settings.terms,
  };

  return {
    invoice_date: invoiceDate,
    financial_year: financialYear,
    side,
    share_percent: sharePercent,
    issuer,
    bill_to: billTo,
    line_items: lineItems,
    place_of_supply: placeName || null,
    place_of_supply_code: placeCode || null,
    gst_mode: tax.appliedMode,
    gst_rate: Number(settings.gst_rate) || 0,
    taxable_total: total,
    cgst: tax.cgst,
    sgst: tax.sgst,
    igst: tax.igst,
    grand_total: tax.grandTotal,
    amount_in_words: amountInWordsIndian(tax.grandTotal),
    currency: clean(deal.currency) || 'INR',
  };
}

/**
 * Re-price the brokerage line after the share changes.
 *
 * `share_percent` is a control, not a label: moving a draft from 50% to
 * 100% has to move the money too. Storing the new share beside the old
 * half-share amount produces an invoice that says "100%" and bills half
 * — which is exactly the kind of disagreement between a stated rate and
 * a charged figure that a customer disputes.
 *
 * Only the first line is derived from the deal; anything an agent added
 * below it (out-of-pocket costs, advertising) is theirs and is left
 * alone.
 */
export function repriceBrokerageLine(
  lineItems: InvoiceLineItem[],
  deal: PrefillDeal | null | undefined,
  sharePercent: number
): InvoiceLineItem[] {
  if (!deal || !lineItems?.length) return lineItems ?? [];

  const amount = brokerageShare(
    {
      dealValue: deal.value,
      type: deal.brokerage_type ?? 'percentage',
      value: deal.brokerage_value,
    },
    sharePercent
  );
  if (amount <= 0) return lineItems;

  return lineItems.map((item, index) =>
    index === 0 ? { ...item, taxable_value: amount } : item
  );
}

/**
 * Recompute the derived totals after an agent edits a draft.
 *
 * The editor lets the line values, the tax mode and the place of supply
 * change, and every one of those moves the totals and the words. Doing
 * it here rather than in the form means the API recomputes identically
 * and a hand-edited total can never reach a customer.
 */
export function recalculate(draft: {
  line_items: InvoiceLineItem[];
  gst_mode: InvoiceSettings['gst_mode'];
  gst_rate: number;
  issuer: InvoiceIssuer;
  place_of_supply_code?: string | null;
}): Pick<
  PrefilledInvoice,
  | 'gst_mode'
  | 'taxable_total'
  | 'cgst'
  | 'sgst'
  | 'igst'
  | 'grand_total'
  | 'amount_in_words'
> {
  const total = taxableTotal(draft.line_items ?? []);
  const tax = computeTax({
    taxableTotal: total,
    gstMode: draft.gst_mode,
    gstRate: Number(draft.gst_rate) || 0,
    supplierStateCode: draft.issuer?.state_code,
    placeOfSupplyCode: draft.place_of_supply_code,
  });
  return {
    gst_mode: tax.appliedMode,
    taxable_total: total,
    cgst: tax.cgst,
    sgst: tax.sgst,
    igst: tax.igst,
    grand_total: tax.grandTotal,
    amount_in_words: amountInWordsIndian(tax.grandTotal),
  };
}
