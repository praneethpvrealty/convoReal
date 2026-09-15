import type { GstMode } from './gst';

export type { GstMode };

export type InvoiceStatus = 'draft' | 'issued' | 'sent' | 'paid' | 'cancelled';

/** Which side of the deal an invoice bills. */
export type InvoiceSide = 'buyer' | 'seller' | 'both';

export type SignatureMode = 'none' | 'image' | 'dsc' | 'esign';

export type DealDocumentCategory =
  | 'identity'
  | 'agreement'
  | 'title_deed'
  | 'encumbrance'
  | 'tax_khata'
  | 'payment'
  | 'invoice'
  | 'other';

/** Labels shown wherever a category is picked or listed. Mirrored in
 *  `mobile/lib/deal-documents.ts` and guarded by `mobile-parity.test.ts`. */
export const DEAL_DOCUMENT_CATEGORIES: ReadonlyArray<{
  value: DealDocumentCategory;
  label: string;
}> = [
  { value: 'identity', label: 'Identity (Aadhaar / PAN)' },
  { value: 'agreement', label: 'Agreement / MOU' },
  { value: 'title_deed', label: 'Title deed' },
  { value: 'encumbrance', label: 'Encumbrance / legal opinion' },
  { value: 'tax_khata', label: 'Khata / tax receipts' },
  { value: 'payment', label: 'Payment proof' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'other', label: 'Other' },
];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  issued: 'Issued',
  sent: 'Sent',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

/**
 * One row of the invoice table.
 *
 * `particulars` is an array because the reference invoice's single line
 * spans four printed rows — the service, then the property it relates
 * to, then its address. Keeping them as separate strings lets the PDF
 * lay them out without having to re-split a blob on newlines.
 */
export interface InvoiceLineItem {
  sl_no: number;
  sac: string;
  particulars: string[];
  taxable_value: number;
}

/** The letterhead and bank block, frozen onto the invoice at issue. */
export interface InvoiceIssuer {
  legal_name: string;
  address_lines: string[];
  rera_number?: string | null;
  pan?: string | null;
  gstin?: string | null;
  state_code?: string | null;
  state_name?: string | null;
  bank_account_name?: string | null;
  bank_name?: string | null;
  bank_account_number?: string | null;
  bank_ifsc?: string | null;
  signatory_label?: string | null;
  gst_note?: string | null;
  terms?: string | null;
}

/** The customer block, frozen onto the invoice at issue. */
export interface InvoiceBillTo {
  name: string;
  address_lines: string[];
  gstin?: string | null;
  pan?: string | null;
  state_code?: string | null;
  state_name?: string | null;
  po_number?: string | null;
  po_date?: string | null;
  email?: string | null;
  phone?: string | null;
}

/** Who signed, how, and under which certificate. Frozen at issue. */
export interface InvoiceSignature {
  mode: SignatureMode;
  signatory_name?: string | null;
  signatory_designation?: string | null;
  place?: string | null;
  /** Bucket-relative path in the private `signatures` bucket. */
  image_path?: string | null;
  /** Set for 'dsc' and 'esign' only. */
  provider?: string | null;
  provider_ref?: string | null;
  certificate_subject?: string | null;
  certificate_serial?: string | null;
}

export interface InvoiceSettings {
  id: string;
  account_id: string;
  legal_name: string;
  address_lines: string[];
  rera_number: string | null;
  pan: string | null;
  gstin: string | null;
  state_code: string | null;
  state_name: string | null;
  default_sac: string;
  default_particulars: string;
  default_share_percent: number;
  gst_mode: GstMode;
  gst_rate: number;
  gst_note: string;
  bank_account_name: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  signatory_label: string;
  terms: string | null;
  signature_mode: SignatureMode;
  signature_image_path: string | null;
  signatory_name: string | null;
  signatory_designation: string | null;
  signature_place: string | null;
  number_prefix: string;
  starting_number: number;
  number_resets_yearly: boolean;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  account_id: string;
  deal_id: string | null;
  property_id: string | null;
  contact_id: string | null;
  party_id: string | null;
  invoice_number: string | null;
  financial_year: string | null;
  sequence_number: number | null;
  invoice_date: string;
  status: InvoiceStatus;
  side: InvoiceSide;
  share_percent: number;
  issuer: InvoiceIssuer;
  bill_to: InvoiceBillTo;
  line_items: InvoiceLineItem[];
  place_of_supply: string | null;
  place_of_supply_code: string | null;
  gst_mode: GstMode;
  gst_rate: number;
  taxable_total: number;
  cgst: number;
  sgst: number;
  igst: number;
  grand_total: number;
  amount_in_words: string | null;
  currency: string;
  notes: string | null;
  document_hash: string | null;
  signature: InvoiceSignature | null;
  signed_at: string | null;
  issued_at: string | null;
  sent_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  pdf_path: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type InvoiceEventName =
  | 'created'
  | 'issued'
  | 'signed'
  | 'sent'
  | 'paid'
  | 'cancelled'
  | 'downloaded';

export interface InvoiceEvent {
  id: string;
  account_id: string;
  invoice_id: string;
  event: InvoiceEventName;
  actor_id: string | null;
  actor_name: string | null;
  ip_address: string | null;
  user_agent: string | null;
  document_hash: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface DealDocument {
  id: string;
  account_id: string;
  deal_id: string;
  contact_id: string | null;
  category: DealDocumentCategory;
  title: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  extracted: ExtractedDocumentFields | null;
  extracted_at: string | null;
  extraction_status: 'pending' | 'done' | 'failed' | null;
  extraction_error: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * What the AI read out of an uploaded document.
 *
 * Every field is optional and every field is a PROPOSAL — the agent
 * applies them one at a time. Note what is absent: there is no
 * `aadhaar_number`. Only the last four digits are ever carried out of
 * the file, so the full number stays in the document and out of every
 * query, backup and log.
 */
export interface ExtractedDocumentFields {
  document_type?: string;
  name?: string;
  address_lines?: string[];
  state_name?: string;
  pincode?: string;
  pan?: string;
  aadhaar_last4?: string;
  father_or_spouse_name?: string;
  date_of_birth?: string;
  /** Deed and agreement fields. */
  parties?: string[];
  survey_number?: string;
  khata_number?: string;
  extent?: string;
  document_number?: string;
  document_date?: string;
  consideration?: number;
  /** Anything the model saw but had no field for. */
  notes?: string;
}
