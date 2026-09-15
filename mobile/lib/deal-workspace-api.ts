/**
 * Invoice and deal-document calls.
 *
 * Split from `deal-workspace.ts` because this half reaches `./api`,
 * which pulls in React Native — and `mobile/lib/**` tests run under a
 * plain Node runner. Keeping the vocabulary importable on its own is
 * what makes it testable.
 */

import { apiFetch } from './api';
import type {
  DealDocumentCategory,
  DealDocumentRow,
  InvoiceDetail,
  InvoiceRow,
  InvoiceSide,
} from './deal-workspace';

export function fetchInvoices(dealId: string) {
  return apiFetch<{ data: InvoiceRow[] }>(
    `/api/deals/${dealId}/brokerage-invoices`
  ).then((json) => json.data ?? []);
}

export function createInvoice(dealId: string) {
  return apiFetch<{ data: InvoiceRow }>(
    `/api/deals/${dealId}/brokerage-invoices`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }
  ).then((json) => json.data);
}

export function invoiceAction(
  invoiceId: string,
  action: 'issue' | 'cancel' | 'mark-paid' | 'send',
  body: Record<string, unknown> = {}
) {
  return apiFetch<{ data: unknown }>(`/api/invoices/${invoiceId}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function fetchDealDocuments(dealId: string) {
  return apiFetch<{ data: DealDocumentRow[] }>(
    `/api/deals/${dealId}/documents`
  ).then((json) => json.data ?? []);
}

export function extractDocument(dealId: string, docId: string) {
  return apiFetch<{ data: DealDocumentRow }>(
    `/api/deals/${dealId}/documents/${docId}/extract`,
    { method: 'POST' }
  ).then((json) => json.data);
}

export function deleteDealDocument(dealId: string, docId: string) {
  return apiFetch<{ data: { id: string } }>(
    `/api/deals/${dealId}/documents/${docId}`,
    { method: 'DELETE' }
  );
}

/**
 * Upload a document into the deal folder.
 *
 * Streamed off disk as multipart rather than read into a base64 string
 * first — the same reason `uploadChatMedia` does: a scanned deed turned
 * into a JavaScript string is how a phone runs out of memory mid-upload.
 */
export async function uploadDealDocument(
  dealId: string,
  file: { uri: string; name: string; mimeType: string },
  category: DealDocumentCategory,
  contactId?: string | null
): Promise<DealDocumentRow> {
  const form = new FormData();
  // React Native's FormData takes this shape for a file on disk; the
  // cast is the standard workaround for the DOM lib's File-only type.
  form.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.mimeType,
  } as unknown as Blob);
  form.append('category', category);
  form.append('title', file.name);
  if (contactId) form.append('contact_id', contactId);

  const { data } = await apiFetch<{ data: DealDocumentRow }>(
    `/api/deals/${dealId}/documents`,
    { method: 'POST', body: form, timeoutMs: 120_000 }
  );
  return data;
}

/** The draft fields the mobile editor can change. Mirrors what the web
 *  editor sends; the server validates and re-derives every total, so
 *  nothing here is trusted as money. */
export interface InvoiceDraftPatch {
  invoice_date?: string;
  side?: InvoiceSide;
  share_percent?: number;
  place_of_supply_code?: string | null;
  gst_mode?: 'nil' | 'intra' | 'inter';
  gst_rate?: number;
  notes?: string | null;
  bill_to?: {
    name: string;
    address_lines: string[];
    gstin?: string | null;
    pan?: string | null;
    po_number?: string | null;
  };
  line_items?: Array<{
    sac: string;
    particulars: string[];
    taxable_value: number;
  }>;
}

export function fetchInvoice(invoiceId: string) {
  return apiFetch<{ data: InvoiceDetail }>(`/api/invoices/${invoiceId}`).then(
    (json) => json.data
  );
}

export function updateInvoice(invoiceId: string, patch: InvoiceDraftPatch) {
  return apiFetch<{ data: InvoiceDetail }>(`/api/invoices/${invoiceId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).then((json) => json.data);
}

export function deleteInvoice(invoiceId: string) {
  return apiFetch<{ data: { id: string } }>(`/api/invoices/${invoiceId}`, {
    method: 'DELETE',
  });
}
