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
  status: DealDocumentStatus | null;
  superseded_by: string | null;
  expires_at: string | null;
  visibility: DealVisibility;
}

/** Mirrors DEAL_DOCUMENT_MIME_TYPES in src/lib/invoices/types.ts and the
 *  `deal-documents` bucket; guarded by src/lib/mobile-parity.test.ts. */
export const DEAL_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroenabled.12',
] as const;

export const DEAL_DOCUMENT_SIZE_LIMIT = 50 * 1024 * 1024;

/** Why this file cannot be filed, or null when it can. A null size means
 *  the picker did not report one — not that the file is empty; the
 *  server measures the bytes it actually receives. */
export function dealDocumentRejection(
  mimeType: string,
  size: number | null
): string | null {
  if (!(DEAL_DOCUMENT_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return 'Upload a PDF, a photo, or a Word or Excel file.';
  }
  if (size === null) return null;
  if (size <= 0) return 'That file is empty.';
  if (size > DEAL_DOCUMENT_SIZE_LIMIT) {
    return `Files can be up to ${Math.round(DEAL_DOCUMENT_SIZE_LIMIT / (1024 * 1024))} MB.`;
  }
  return null;
}

export function documentSizeLabel(bytes: number): string {
  if (bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

// ------------------------------------------------------------------
// Transaction Workspace (Phase 1). Mirrored from src/lib/deals/*;
// guarded by src/lib/mobile-parity.test.ts.
// ------------------------------------------------------------------

export type DealWorkspaceTab =
  | 'overview'
  | 'timeline'
  | 'milestones'
  | 'tasks'
  | 'documents'
  | 'stakeholders'
  | 'invoices';

/** Mirrored from src/components/deals/deal-workspace.tsx. */
export const DEAL_WORKSPACE_TABS: ReadonlyArray<{
  id: DealWorkspaceTab;
  label: string;
}> = [
  { id: 'overview', label: 'Overview' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'milestones', label: 'Milestones' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'documents', label: 'Documents' },
  { id: 'stakeholders', label: 'Stakeholders' },
  { id: 'invoices', label: 'Invoices' },
];

export type DealMilestoneStatus =
  'pending' | 'in_progress' | 'completed' | 'skipped';

/** Mirrored from src/lib/deals/milestones.ts. */
export const DEAL_MILESTONE_STATUS_LABELS: Record<DealMilestoneStatus, string> =
  {
    pending: 'Pending',
    in_progress: 'In progress',
    completed: 'Completed',
    skipped: 'Skipped',
  };

export interface DealMilestoneRow {
  id: string;
  template_key: string | null;
  title: string;
  position: number;
  status: DealMilestoneStatus;
  target_date: string | null;
  completed_at: string | null;
  notes: string | null;
  visibility: DealVisibility;
}

export type DealDocumentStatus = 'draft' | 'reviewed' | 'approved' | 'executed';

/** Mirrored from src/lib/deals/documents.ts. */
export const DEAL_DOCUMENT_STATUS_LABELS: Record<DealDocumentStatus, string> = {
  draft: 'Draft',
  reviewed: 'Reviewed',
  approved: 'Approved',
  executed: 'Executed',
};

const DOCUMENT_STATUS_ORDER: DealDocumentStatus[] = [
  'draft',
  'reviewed',
  'approved',
  'executed',
];

/** Forward only — mirrors canTransitionDocumentStatus on the server. */
export function nextDocumentStatuses(
  from: DealDocumentStatus | null
): DealDocumentStatus[] {
  if (from === null) return DOCUMENT_STATUS_ORDER;
  return DOCUMENT_STATUS_ORDER.slice(DOCUMENT_STATUS_ORDER.indexOf(from) + 1);
}

/** Approved and executed papers are superseded, never deleted. */
export function canDeleteDocument(doc: {
  status: DealDocumentStatus | null;
  superseded_by: string | null;
}): boolean {
  if (doc.superseded_by) return false;
  return doc.status !== 'approved' && doc.status !== 'executed';
}

export type DealEventType =
  | 'created'
  | 'converted_from_journey'
  | 'stage_changed'
  | 'financials_updated'
  | 'milestone_added'
  | 'milestone_updated'
  | 'task_added'
  | 'document_added'
  | 'document_status_changed'
  | 'document_superseded'
  | 'group_changed'
  | 'note_added'
  | 'stakeholder_added'
  | 'stakeholder_updated'
  | 'stakeholder_removed'
  | 'link_created'
  | 'link_revoked';

/** Mirrored from src/lib/deals/events.ts. */
export const DEAL_EVENT_LABELS: Record<DealEventType, string> = {
  created: 'Deal created',
  converted_from_journey: 'Converted from journey',
  stage_changed: 'Stage changed',
  financials_updated: 'Financials updated',
  milestone_added: 'Milestone added',
  milestone_updated: 'Milestone updated',
  task_added: 'Task added',
  document_added: 'Document added',
  document_status_changed: 'Document status changed',
  document_superseded: 'Document superseded',
  group_changed: 'Bundle changed',
  note_added: 'Note',
  stakeholder_added: 'Stakeholder added',
  stakeholder_updated: 'Stakeholder updated',
  stakeholder_removed: 'Stakeholder removed',
  link_created: 'Share link created',
  link_revoked: 'Share link revoked',
};

export interface DealEventRow {
  id: string;
  event_type: DealEventType;
  source: 'web' | 'mobile' | 'api' | 'system';
  actor_name: string | null;
  title: string;
  metadata: Record<string, unknown>;
  visibility: DealVisibility;
  created_at: string;
}

export type TdsStatus =
  'not_applicable' | 'expected' | 'deducted' | 'deposited';

/** Mirrored from src/lib/deals/financials.ts. */
export const TDS_STATUS_LABELS: Record<TdsStatus, string> = {
  not_applicable: 'Not applicable',
  expected: 'Expected',
  deducted: 'Deducted',
  deposited: 'Deposited',
};

export interface DealFinancialsRow {
  agreed_consideration: number | null;
  registered_consideration: number | null;
  other_component: number | null;
  token_amount: number | null;
  token_received_at: string | null;
  token_instrument_ref: string | null;
  tds_status: TdsStatus | null;
  tds_amount: number | null;
  payment_instrument_refs: string | null;
  brokerage_received_amount: number | null;
  token_source: 'deal' | 'token_safe';
  token: {
    source: 'deal' | 'token_safe';
    amount: number | null;
    received_at: string | null;
    reference: string | null;
    status: string | null;
  };
}

export interface DealTaskRow {
  id: string;
  title: string;
  due_date: string | null;
  priority: 'low' | 'medium' | 'high';
  completed: boolean;
}

/** Build the PATCH body for the financials form: only fields that
 *  changed, blanks as null, and never a token field when Token Safe
 *  owns it. The server validates every value again. */
export function financialsPatch(
  before: Record<string, string>,
  after: Record<string, string>,
  tokenSource: 'deal' | 'token_safe'
): Record<string, string | null> {
  const patch: Record<string, string | null> = {};
  for (const key of Object.keys(after)) {
    if (after[key] === (before[key] ?? '')) continue;
    if (tokenSource === 'token_safe' && key.startsWith('token_')) continue;
    patch[key] = after[key] === '' ? null : after[key];
  }
  return patch;
}

// ------------------------------------------------------------------
// Transaction Workspace Phase 2 — stakeholders, links, visibility.
// Mirrored from src/lib/deals/{stakeholders,share-links,visibility}.ts;
// guarded by src/lib/mobile-parity.test.ts.
// ------------------------------------------------------------------

export type DealVisibility =
  'internal' | 'buyer_side' | 'seller_side' | 'all_stakeholders';

/** Mirrored from src/lib/deals/visibility.ts. */
export const DEAL_VISIBILITY_LABELS: Record<DealVisibility, string> = {
  internal: 'Internal only',
  buyer_side: 'Buyer side',
  seller_side: 'Seller side',
  all_stakeholders: 'All stakeholders',
};

export type DealSide = 'buyer' | 'seller' | 'internal';

export type StakeholderRole =
  'buyer' | 'seller' | 'advocate' | 'banker' | 'broker' | 'witness' | 'other';

/** Mirrored from src/lib/deals/stakeholders.ts. */
export const STAKEHOLDER_ROLE_LABELS: Record<StakeholderRole, string> = {
  buyer: 'Buyer',
  seller: 'Seller',
  advocate: 'Advocate',
  banker: 'Banker',
  broker: 'Broker',
  witness: 'Witness',
  other: 'Other',
};

/** Mirrored from src/lib/deals/stakeholders.ts. */
export const STAKEHOLDER_SIDE_LABELS: Record<DealSide, string> = {
  buyer: 'Buyer side',
  seller: 'Seller side',
  internal: 'Internal',
};

/** Mirrored from src/lib/deals/stakeholders.ts. */
export function defaultSideForRole(role: StakeholderRole): DealSide {
  switch (role) {
    case 'seller':
      return 'seller';
    case 'broker':
      return 'internal';
    default:
      return 'buyer';
  }
}

export interface DealShareLinkRow {
  id: string;
  token_prefix: string;
  expires_at: string;
  revoked_at: string | null;
  otp_required: boolean;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
}

export interface DealStakeholderRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: StakeholderRole;
  side: DealSide;
  links: DealShareLinkRow[];
}

/** Mirrored from src/lib/deals/share-links.ts. */
export const DEAL_SHARE_TTL_CHOICES = [
  { key: '24h', label: '24 hours' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
] as const;

export type DealShareTtlKey = (typeof DEAL_SHARE_TTL_CHOICES)[number]['key'];

export type DealShareLinkState = 'active' | 'expired' | 'revoked';

export type DealShareAccessEvent =
  | 'view'
  | 'denied'
  | 'otp_sent'
  | 'otp_verified'
  | 'otp_failed'
  | 'document_view'
  | 'document_denied';

/** Mirrored from src/lib/deals/share-links.ts. */
export const SHARE_ACCESS_LABELS: Record<DealShareAccessEvent, string> = {
  view: 'Opened',
  denied: 'Denied (link dead)',
  otp_sent: 'Code sent',
  otp_verified: 'Code verified',
  otp_failed: 'Code failed',
  document_view: 'Document opened',
  document_denied: 'Document refused',
};

/** Mirrors linkState on the server: revoked wins, then expiry. */
export function linkState(
  link: Pick<DealShareLinkRow, 'expires_at' | 'revoked_at'>,
  now: Date = new Date()
): DealShareLinkState {
  if (link.revoked_at) return 'revoked';
  if (new Date(link.expires_at) <= now) return 'expired';
  return 'active';
}

/** The message the agent hands over on WhatsApp — the app never sends
 *  it; the share sheet does. */
export function shareLinkMessage(
  name: string,
  dealTitle: string,
  url: string
): string {
  return `Hi ${name}, here is your private link to the ${dealTitle} transaction: ${url}\nIt expires automatically. Please don't forward it.`;
}
