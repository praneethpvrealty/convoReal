// ------------------------------------------------------------------
// Deal-invoice helpers — pure, so they run under the plain Node test
// runner (same split as property-documents.ts and stage-semantics.ts).
//
// Mirrors src/lib/pipelines/deal-invoices.ts. The bucket is private:
// nothing here builds a URL, and the app only ever renders the
// short-lived signed link that /api/deals/[id]/invoices returns. Keep
// the ceiling and the accepted types in step with the web copy, so a
// file that uploads from one surface is never refused from the other.
// ------------------------------------------------------------------

export const INVOICE_SIZE_LIMIT = 10 * 1024 * 1024;

export const INVOICE_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

export interface DealInvoiceLink {
  path: string;
  name: string;
  size: number;
  uploaded_at: string;
  uploaded_by: string | null;
  url: string | null;
}

/** Why this file cannot be attached, or null when it can.
 *
 *  A null size means the picker did not report one — not that the file
 *  is empty. The server measures the bytes it actually receives, so an
 *  unknown size passes here rather than blocking a valid document. */
export function invoiceRejection(
  mimeType: string,
  size: number | null
): string | null {
  if (!(INVOICE_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return 'Invoices must be a PDF, an image, or a Word/Excel file.';
  }
  if (size === null) return null;
  if (size <= 0) return 'That file is empty.';
  if (size > INVOICE_SIZE_LIMIT) {
    return `Invoices can be up to ${Math.round(INVOICE_SIZE_LIMIT / (1024 * 1024))} MB.`;
  }
  return null;
}

export function invoiceSizeLabel(bytes: number): string {
  if (bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
