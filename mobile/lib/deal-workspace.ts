/**
 * Invoice and deal-document vocabulary, shared by the screen and the
 * API client beside it.
 *
 * Deliberately free of imports: `mobile/lib/**` tests run under a plain
 * Node runner with no React Native or Expo runtime, so anything that
 * reaches `./api` cannot be unit tested. The calls live in
 * `deal-workspace-api.ts`; only labels and predicates live here.
 *
 * Nothing in this file computes money. The amount, the tax split, the
 * invoice number and the PDF all come from the server, so the two
 * surfaces cannot disagree about what a customer was billed
 * (root AGENTS.md §2.8). The constants are mirrored from
 * `src/lib/invoices/types.ts` and `src/lib/mobile-parity.test.ts` fails
 * if the two copies drift.
 */

export type InvoiceStatus = 'draft' | 'issued' | 'sent' | 'paid' | 'cancelled';
export type InvoiceSide = 'buyer' | 'seller' | 'both';

export type DealDocumentCategory =
  | 'identity'
  | 'agreement'
  | 'title_deed'
  | 'encumbrance'
  | 'tax_khata'
  | 'payment'
  | 'invoice'
  | 'other';

/** Mirrored from src/lib/invoices/types.ts — see the header. */
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

/** Mirrored from src/lib/invoices/types.ts — see the header. */
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  issued: 'Issued',
  sent: 'Sent',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

export interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  status: InvoiceStatus;
  side: InvoiceSide;
  share_percent: number;
  bill_to: { name?: string } | null;
  gst_mode: string;
  taxable_total: number;
  cgst: number;
  sgst: number;
  igst: number;
  grand_total: number;
  cancel_reason: string | null;
}

/** One invoice with the fields the editor needs. The list rows carry a
 *  subset; this is what `GET /api/invoices/[id]` returns. */
export interface InvoiceDetail extends InvoiceRow {
  deal_id: string | null;
  place_of_supply: string | null;
  place_of_supply_code: string | null;
  gst_rate: number;
  notes: string | null;
  amount_in_words: string | null;
  bill_to: {
    name?: string;
    address_lines?: string[];
    gstin?: string | null;
    pan?: string | null;
    po_number?: string | null;
  } | null;
  line_items: Array<{
    sl_no: number;
    sac: string;
    particulars: string[];
    taxable_value: number;
  }>;
}

export interface DealDocumentRow {
  id: string;
  title: string;
  category: DealDocumentCategory;
  mime_type: string | null;
  size_bytes: number | null;
  extracted: Record<string, unknown> | null;
  extraction_status: 'pending' | 'done' | 'failed' | null;
  created_at: string;
}

export function categoryLabel(category: DealDocumentCategory | string): string {
  return (
    DEAL_DOCUMENT_CATEGORIES.find((c) => c.value === category)?.label ??
    String(category)
  );
}

/** Only a PDF or a photo can be read by the extractor. */
export function isReadable(mimeType: string | null | undefined): boolean {
  return ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(
    (mimeType ?? '').toLowerCase()
  );
}

/**
 * Human-readable summary of an AI read-out.
 *
 * Note that no field here can hold a full Aadhaar number: the server
 * strips it before storing, so what reaches the phone is already safe
 * to render.
 */
export function extractionEntries(
  extracted: Record<string, unknown> | null | undefined
): Array<{ key: string; label: string; value: string }> {
  if (!extracted) return [];
  const labels: Record<string, string> = {
    document_type: 'Document type',
    name: 'Name',
    address_lines: 'Address',
    state_name: 'State',
    pincode: 'PIN code',
    pan: 'PAN',
    aadhaar_last4: 'Aadhaar (last 4)',
    father_or_spouse_name: 'Father / spouse',
    date_of_birth: 'Date of birth',
    parties: 'Parties',
    survey_number: 'Survey no.',
    khata_number: 'Khata no.',
    extent: 'Extent',
    document_number: 'Document no.',
    document_date: 'Document date',
    consideration: 'Consideration',
    notes: 'Notes',
  };

  return Object.entries(extracted)
    .filter(([, value]) =>
      Array.isArray(value)
        ? value.length > 0
        : value !== null && value !== undefined && String(value).length > 0
    )
    .map(([key, value]) => ({
      key,
      label: labels[key] ?? key,
      value: Array.isArray(value) ? value.join('\n') : String(value),
    }));
}
