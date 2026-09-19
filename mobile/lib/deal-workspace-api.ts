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
  DealDocumentStatus,
  DealEventRow,
  DealFinancialsRow,
  DealMilestoneRow,
  DealMilestoneStatus,
  DealShareLinkRow,
  DealShareTtlKey,
  DealSide,
  DealStakeholderRow,
  DealTaskRow,
  DealUpdateRecipientRow,
  DealUpdateRow,
  DealUpdateVisibility,
  DealVisibility,
  UpdateChannel,
  InvoiceDetail,
  InvoiceRow,
  InvoiceSide,
  StakeholderRole,
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

export function fetchDealDocuments(
  dealId: string,
  category?: DealDocumentCategory
) {
  const query = category ? `?category=${encodeURIComponent(category)}` : '';
  return apiFetch<{ data: DealDocumentRow[] }>(
    `/api/deals/${dealId}/documents${query}`
  ).then((json) => json.data ?? []);
}

/** A short-lived signed link to the stored file. The listing never
 *  carries URLs, so this is minted per open and not cached. */
export function fetchDealDocumentUrl(dealId: string, docId: string) {
  return apiFetch<{ data: { url: string } }>(
    `/api/deals/${dealId}/documents/${docId}?format=json`
  ).then((json) => json.data.url);
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

// ------------------------------------------------------------------
// Transaction Workspace calls. Every rule lives server-side; the app
// only renders what these return.
// ------------------------------------------------------------------

function json(body: Record<string, unknown>) {
  return {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, source: 'mobile' }),
  };
}

export function fetchDealFinancials(dealId: string) {
  return apiFetch<{ data: DealFinancialsRow }>(
    `/api/deals/${dealId}/financials`
  ).then((r) => r.data);
}

export function updateDealFinancials(
  dealId: string,
  patch: Record<string, string | null>
) {
  return apiFetch<{ data: DealFinancialsRow }>(
    `/api/deals/${dealId}/financials`,
    {
      method: 'PATCH',
      ...json(patch),
    }
  ).then((r) => r.data);
}

export function fetchDealEvents(dealId: string) {
  return apiFetch<{ data: DealEventRow[] }>(`/api/deals/${dealId}/events`).then(
    (r) => r.data ?? []
  );
}

export function addDealNote(dealId: string, note: string) {
  return apiFetch<{ data: { id: string } }>(`/api/deals/${dealId}/events`, {
    method: 'POST',
    ...json({ note }),
  });
}

export function fetchDealMilestones(dealId: string) {
  return apiFetch<{ data: DealMilestoneRow[] }>(
    `/api/deals/${dealId}/milestones`
  ).then((r) => r.data ?? []);
}

/** The same PATCH the web board and workspace use: the route derives
 *  the deal status and syncs the property from the stage name. */
export function moveDealStage(
  dealId: string,
  input: {
    status: 'open' | 'won' | 'lost';
    target_stage_id: string;
    property_id: string | null;
    current_stage_name: string;
  }
) {
  return apiFetch<{ id: string; status: string }>(`/api/deals/${dealId}`, {
    method: 'PATCH',
    ...json(input),
  });
}

export function addStandardMilestones(dealId: string) {
  return apiFetch<{ data: DealMilestoneRow[] }>(
    `/api/deals/${dealId}/milestones`,
    {
      method: 'POST',
      ...json({ template: 'standard' }),
    }
  );
}

export function addCustomMilestone(
  dealId: string,
  title: string,
  targetDate: string | null
) {
  return apiFetch<{ data: DealMilestoneRow }>(
    `/api/deals/${dealId}/milestones`,
    {
      method: 'POST',
      ...json({ title, target_date: targetDate }),
    }
  );
}

export function updateDealMilestone(
  dealId: string,
  milestoneId: string,
  patch: { status?: DealMilestoneStatus; target_date?: string | null }
) {
  return apiFetch<{ data: DealMilestoneRow }>(
    `/api/deals/${dealId}/milestones/${milestoneId}`,
    { method: 'PATCH', ...json(patch) }
  ).then((r) => r.data);
}

export function fetchDealTasks(dealId: string) {
  return apiFetch<DealTaskRow[]>(
    `/api/todos?deal_id=${encodeURIComponent(dealId)}`
  ).then((rows) => (Array.isArray(rows) ? rows : []));
}

export function addDealTask(
  dealId: string,
  input: {
    title: string;
    priority: DealTaskRow['priority'];
    dueDate: string | null;
    contactId: string | null;
    propertyId: string | null;
  }
) {
  return apiFetch<DealTaskRow>('/api/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: input.title,
      priority: input.priority,
      due_date: input.dueDate,
      contact_id: input.contactId,
      property_id: input.propertyId,
      deal_id: dealId,
    }),
  });
}

export function setDealTaskCompleted(taskId: string, completed: boolean) {
  return apiFetch<DealTaskRow>(`/api/todos/${taskId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ completed }),
  });
}

export function updateDealDocument(
  dealId: string,
  docId: string,
  patch: {
    status?: DealDocumentStatus;
    expires_at?: string | null;
    superseded_by?: string;
  }
) {
  return apiFetch<{ data: DealDocumentRow }>(
    `/api/deals/${dealId}/documents/${docId}`,
    { method: 'PATCH', ...json(patch) }
  ).then((r) => r.data);
}

/** Open the closing record for a journey item. Idempotent: returns the
 *  existing transaction when the item already has one. */
export function convertJourneyItemToDeal(itemId: string) {
  return apiFetch<{ data: { id: string; existing: boolean } }>(
    '/api/journey/convert-to-deal',
    { method: 'POST', ...json({ item_id: itemId }) }
  ).then((r) => r.data);
}

// ------------------------------------------------------------------
// Phase 2 — stakeholders and share links.
// ------------------------------------------------------------------

export function fetchDealStakeholders(dealId: string) {
  return apiFetch<{ data: DealStakeholderRow[] }>(
    `/api/deals/${dealId}/stakeholders`
  ).then((r) => r.data ?? []);
}

export function addDealStakeholder(
  dealId: string,
  input: {
    name: string;
    role: StakeholderRole;
    side: DealSide;
    phone: string | null;
    email: string | null;
  }
) {
  return apiFetch<{ data: DealStakeholderRow }>(
    `/api/deals/${dealId}/stakeholders`,
    {
      method: 'POST',
      ...json(input),
    }
  ).then((r) => r.data);
}

export function removeDealStakeholder(dealId: string, stakeholderId: string) {
  return apiFetch<{ data: { id: string } }>(
    `/api/deals/${dealId}/stakeholders/${stakeholderId}`,
    { method: 'DELETE' }
  );
}

/** The plaintext URL comes back exactly once, in this response. */
export function createDealShareLink(
  dealId: string,
  input: { stakeholderId: string; ttl: DealShareTtlKey; otpRequired: boolean }
) {
  return apiFetch<{ data: DealShareLinkRow & { url: string } }>(
    `/api/deals/${dealId}/share-links`,
    {
      method: 'POST',
      ...json({
        stakeholder_id: input.stakeholderId,
        ttl: input.ttl,
        otp_required: input.otpRequired,
      }),
    }
  ).then((r) => r.data);
}

export function revokeDealShareLink(dealId: string, linkId: string) {
  return apiFetch<{ data: { id: string } }>(
    `/api/deals/${dealId}/share-links/${linkId}?source=mobile`,
    { method: 'DELETE' }
  );
}

export function fetchDealShareAccess(dealId: string, linkId: string) {
  return apiFetch<{
    data: Array<{ id: string; event: string; created_at: string }>;
  }>(`/api/deals/${dealId}/share-links/${linkId}/access`).then(
    (r) => r.data ?? []
  );
}

export function setDealMilestoneVisibility(
  dealId: string,
  milestoneId: string,
  visibility: DealVisibility
) {
  return apiFetch<{ data: DealMilestoneRow }>(
    `/api/deals/${dealId}/milestones/${milestoneId}`,
    { method: 'PATCH', ...json({ visibility }) }
  ).then((r) => r.data);
}

export function addDealNoteWithVisibility(
  dealId: string,
  note: string,
  visibility: DealVisibility
) {
  return apiFetch<{ data: { id: string } }>(`/api/deals/${dealId}/events`, {
    method: 'POST',
    ...json({ note, visibility }),
  });
}

export function setDealDocumentVisibility(
  dealId: string,
  docId: string,
  visibility: DealVisibility
) {
  return apiFetch<{ data: DealDocumentRow }>(
    `/api/deals/${dealId}/documents/${docId}`,
    { method: 'PATCH', ...json({ visibility }) }
  ).then((r) => r.data);
}

// ------------------------------------------------------------------
// Phase 3 — published updates.
// ------------------------------------------------------------------

export interface UpdateComposePayload {
  headline: string;
  body: string | null;
  visibility: DealUpdateVisibility;
  milestone_ids: string[];
  event_ids: string[];
  supersedes_update_id: string | null;
  recipients: Array<{ stakeholder_id: string; channel: UpdateChannel }>;
  ttl: DealShareTtlKey;
  otp_required: boolean;
}

export interface UpdatePreviewRecipient {
  stakeholder_id: string;
  name: string;
  channel: UpdateChannel;
  eligible: boolean;
  mode: string | null;
  reason: string | null;
  needs_email: boolean;
  text: string;
}

export function fetchDealUpdates(dealId: string) {
  return apiFetch<{ data: DealUpdateRow[] }>(
    `/api/deals/${dealId}/updates`
  ).then((r) => r.data ?? []);
}

export function previewDealUpdate(
  dealId: string,
  payload: UpdateComposePayload
) {
  return apiFetch<{ data: { recipients: UpdatePreviewRecipient[] } }>(
    `/api/deals/${dealId}/updates/preview`,
    { method: 'POST', ...json({ ...payload }) }
  ).then((r) => r.data.recipients ?? []);
}

/** Plaintext links for handoff recipients come back exactly once, in
 *  this response. */
export function publishDealUpdate(
  dealId: string,
  payload: UpdateComposePayload
) {
  return apiFetch<{
    data: { update: DealUpdateRow; recipients: DealUpdateRecipientRow[] };
  }>(`/api/deals/${dealId}/updates`, {
    method: 'POST',
    ...json({ ...payload }),
  }).then((r) => r.data);
}

export function markUpdateRecipientSent(
  dealId: string,
  updateId: string,
  recipientId: string
) {
  return apiFetch<{ data: DealUpdateRecipientRow }>(
    `/api/deals/${dealId}/updates/${updateId}/recipients/${recipientId}`,
    { method: 'PATCH', ...json({ status: 'sent' }) }
  ).then((r) => r.data);
}
