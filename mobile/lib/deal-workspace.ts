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
  | 'updates'
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
  { id: 'updates', label: 'Updates' },
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
  | 'link_revoked'
  | 'update_published'
  | 'update_acknowledged';

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
  update_published: 'Update published',
  update_acknowledged: 'Update acknowledged',
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

// --- Payment schedule — mirrored from src/lib/deals/tranches.ts ----------

export type TrancheStatus =
  'received' | 'partial' | 'overdue' | 'due' | 'scheduled';

/** Mirrored from src/lib/deals/tranches.ts — see the header. */
export const TRANCHE_STATUS_LABELS: Record<TrancheStatus, string> = {
  received: 'Received',
  partial: 'Part received',
  overdue: 'Overdue',
  due: 'Due today',
  scheduled: 'Scheduled',
};

export const TRANCHE_LABEL_SUGGESTIONS: readonly string[] = [
  'Token',
  'On agreement',
  'On registration',
  'On possession',
  'Bank loan disbursement',
];

export interface DealPaymentTrancheRow {
  id: string;
  account_id: string;
  deal_id: string;
  position: number;
  label: string;
  amount: number;
  due_date: string | null;
  received_at: string | null;
  received_amount: number | null;
  instrument_ref: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrancheSummary {
  count: number;
  scheduled: number;
  received: number;
  outstanding: number;
}

export interface TrancheSchedule {
  tranches: DealPaymentTrancheRow[];
  summary: TrancheSummary;
}

/** Mirrored from src/lib/deals/tranches.ts. The totals come from the
 *  server; this only decides which label a row wears. */
export function trancheReceived(
  t: Pick<DealPaymentTrancheRow, 'amount' | 'received_at' | 'received_amount'>
): number {
  if (t.received_amount !== null && t.received_amount !== undefined) {
    return Math.min(t.received_amount, t.amount);
  }
  return t.received_at ? t.amount : 0;
}

export function trancheStatus(
  t: Pick<
    DealPaymentTrancheRow,
    'amount' | 'due_date' | 'received_at' | 'received_amount'
  >,
  today: string
): TrancheStatus {
  const received = trancheReceived(t);
  if (received >= t.amount && (t.received_at || received > 0))
    return 'received';
  if (received > 0) return 'partial';
  if (!t.due_date) return 'scheduled';
  if (t.due_date < today) return 'overdue';
  if (t.due_date === today) return 'due';
  return 'scheduled';
}

// --- Bundles — mirrored from src/lib/deals/bundles.ts -------------------

export const BUNDLE_MIN_DEALS = 2;
export const BUNDLE_MAX_DEALS = 20;
export const BUNDLE_NAME_MAX = 120;

export interface BundleCandidate {
  id: string;
  title: string;
  contact_id: string | null;
  contact_name: string | null;
  property_title: string | null;
  property_unit_no: string | null;
  stage_name: string | null;
  deal_group_id: string | null;
}

export interface BundleAnchor {
  id: string;
  contact_id: string | null;
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function bundleCandidateLabel(
  row: Pick<BundleCandidate, 'title' | 'property_title' | 'property_unit_no'>
): string {
  const unit = cleanText(row.property_unit_no);
  if (unit) return `Property No. ${unit}`;
  return cleanText(row.property_title) ?? row.title;
}

export function bundleCandidates<T extends BundleCandidate>(
  rows: readonly T[],
  anchor: BundleAnchor
): T[] {
  return rows
    .filter((r) => r.id !== anchor.id && !r.deal_group_id)
    .sort((a, b) => {
      const aSame =
        Boolean(anchor.contact_id) && a.contact_id === anchor.contact_id;
      const bSame =
        Boolean(anchor.contact_id) && b.contact_id === anchor.contact_id;
      if (aSame !== bSame) return aSame ? -1 : 1;
      return bundleCandidateLabel(a).localeCompare(bundleCandidateLabel(b));
    });
}

export function sameBuyerIds(
  candidates: readonly BundleCandidate[],
  anchor: BundleAnchor
): string[] {
  if (!anchor.contact_id) return [];
  return candidates
    .filter((c) => c.contact_id === anchor.contact_id)
    .map((c) => c.id);
}

export function defaultBundleName(
  contactName: string | null | undefined
): string {
  const who = cleanText(contactName);
  return (who ? `${who} — linked purchases` : 'Linked purchases').slice(
    0,
    BUNDLE_NAME_MAX
  );
}

export function bundleBlocker(
  name: string,
  selectedCount: number
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Give the bundle a name.';
  if (trimmed.length > BUNDLE_NAME_MAX) {
    return `Keep the name under ${BUNDLE_NAME_MAX} characters.`;
  }
  if (selectedCount < BUNDLE_MIN_DEALS) {
    return 'Pick at least one more deal to bundle with this one.';
  }
  if (selectedCount > BUNDLE_MAX_DEALS) {
    return `A bundle holds at most ${BUNDLE_MAX_DEALS} deals.`;
  }
  return null;
}

export interface BundleMemberRow {
  id: string;
  title: string;
  value: number | null;
  stage:
    | { name: string; color: string | null }
    | { name: string; color: string | null }[]
    | null;
  contact:
    | { name: string | null; second_name: string | null }
    | { name: string | null; second_name: string | null }[]
    | null;
  property:
    | { title: string | null; unit_no: string | null }
    | { title: string | null; unit_no: string | null }[]
    | null;
  progress: { total: number; done: number };
}

export interface BundleDetail {
  id: string;
  name: string;
  deals: BundleMemberRow[];
  progress: { total: number; done: number };
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

// ------------------------------------------------------------------
// Phase 3 — published updates. Mirrored from src/lib/deals/updates.ts;
// guarded by src/lib/mobile-parity.test.ts.
// ------------------------------------------------------------------

export type DealUpdateVisibility = Exclude<DealVisibility, 'internal'>;

export const DEAL_UPDATE_VISIBILITIES: readonly DealUpdateVisibility[] = [
  'buyer_side',
  'seller_side',
  'all_stakeholders',
];

export type UpdateChannel =
  'engine_whatsapp' | 'personal_whatsapp' | 'portal_only';

export const UPDATE_CHANNELS: readonly UpdateChannel[] = [
  'engine_whatsapp',
  'personal_whatsapp',
  'portal_only',
];

/** Mirrored from src/lib/deals/updates.ts. */
export const UPDATE_CHANNEL_LABELS: Record<UpdateChannel, string> = {
  engine_whatsapp: 'WhatsApp (business number)',
  personal_whatsapp: 'WhatsApp (my phone)',
  portal_only: 'Link only',
};

export type UpdateRecipientStage =
  'pending' | 'sent' | 'opened' | 'acknowledged' | 'failed';

/** Mirrored from src/lib/deals/updates.ts. */
export const UPDATE_STAGE_LABELS: Record<UpdateRecipientStage, string> = {
  pending: 'To hand over',
  sent: 'Sent',
  opened: 'Opened',
  acknowledged: 'Acknowledged',
  failed: 'Not delivered',
};

export interface DealUpdateRecipientRow {
  id: string;
  update_id: string;
  stakeholder_id: string;
  channel: UpdateChannel;
  delivery_mode: 'free_form' | 'template' | 'handoff' | 'portal' | null;
  status: 'pending' | 'sent' | 'failed';
  failed_reason: string | null;
  sent_at: string | null;
  opened_at: string | null;
  acknowledged_at: string | null;
  acknowledged_via: 'portal' | 'whatsapp' | null;
  stakeholder: { id: string; name: string; role: string; side: string } | null;
  url?: string;
  notice?: string;
  handoff_url?: string;
}

export interface DealUpdateRow {
  id: string;
  headline: string;
  body: string | null;
  visibility: DealUpdateVisibility;
  snapshot: {
    progress: { total: number; done: number };
    milestones: Array<{
      id: string;
      title: string;
      status: DealMilestoneStatus;
      target_date: string | null;
    }>;
    events: Array<{ id: string; title: string }>;
  };
  supersedes_update_id: string | null;
  published_by_name: string | null;
  created_at: string;
  recipients: DealUpdateRecipientRow[];
}

/** Mirrors recipientStage on the server: the furthest fact leads, the
 *  three stay separate on the row. */
export function recipientStage(
  r: Pick<DealUpdateRecipientRow, 'status' | 'opened_at' | 'acknowledged_at'>
): UpdateRecipientStage {
  if (r.acknowledged_at) return 'acknowledged';
  if (r.opened_at) return 'opened';
  if (r.status === 'failed') return 'failed';
  if (r.status === 'sent') return 'sent';
  return 'pending';
}

/** Mirrors sideCanSee for an update's audience: which stakeholders can
 *  receive it. */
export function isEligibleRecipient(
  stakeholder: { side: DealSide },
  visibility: DealUpdateVisibility
): boolean {
  if (stakeholder.side === 'internal') return false;
  if (visibility === 'all_stakeholders') return true;
  return visibility === `${stakeholder.side}_side`;
}

/** Mirrors snapshotItemAllowed: an item may be quoted only when every
 *  side reading the update may already see it. */
export function snapshotItemAllowed(
  update: DealUpdateVisibility,
  item: DealVisibility
): boolean {
  if (item === 'internal') return false;
  if (item === 'all_stakeholders') return true;
  return update === item;
}

/** Mirrored from src/lib/deals/index-row.ts — see the header. */
export interface TransactionIndexParties {
  title: string;
  contact_name: string | null;
  property_title: string | null;
  property_unit_no: string | null;
}

/** Mirrored from src/lib/deals/index-row.ts — see the header. */
export interface TransactionIndexOrigin {
  source_journey_item_id: string | null;
  milestones_total: number;
}

/** One row of transaction_workspace_index(); mirrors IndexRow on the web. */
export interface TransactionIndexRow
  extends TransactionIndexParties, TransactionIndexOrigin {
  id: string;
  status: 'open' | 'won' | 'lost';
  value: number | null;
  stage_name: string | null;
  stage_color: string | null;
  group_name: string | null;
  milestones_done: number;
  next_milestone_title: string | null;
  next_milestone_target_date: string | null;
  expected_close_date: string | null;
  actual_close_date: string | null;
  updated_at: string;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function transactionPropertyLabel(
  row: Pick<TransactionIndexParties, 'property_title' | 'property_unit_no'>
): string | null {
  const unit = clean(row.property_unit_no);
  if (unit) return `Property No. ${unit}`;
  return clean(row.property_title);
}

export function transactionTitle(row: TransactionIndexParties): string {
  const who = clean(row.contact_name);
  const what = transactionPropertyLabel(row);
  if (who && what) return `${who} — ${what}`;
  return who ?? what ?? row.title;
}

export function transactionSubtitle(
  row: TransactionIndexParties
): string | null {
  const title = clean(row.title);
  if (!title) return null;
  const headline = transactionTitle(row);
  if (headline.toLowerCase().includes(title.toLowerCase())) return null;
  return title;
}

export function isClosingRecord(row: TransactionIndexOrigin): boolean {
  return row.source_journey_item_id !== null || row.milestones_total > 0;
}

export type RecordsSort = 'updated' | 'close';

/** Mirrored from src/lib/deals/index-row.ts. */
export const RECORDS_SORTS: ReadonlyArray<{ id: RecordsSort; label: string }> =
  [
    { id: 'updated', label: 'Recent' },
    { id: 'close', label: 'Close date' },
  ];

export interface TransactionIndexDates {
  expected_close_date: string | null;
  actual_close_date: string | null;
  updated_at: string;
}

/** "Closes 2026-10-10", "Close date passed", "Closed 2026-10-08", or
 *  null when no date was forecast. `today` is YYYY-MM-DD in the
 *  reader's calendar. */
export function expectedCloseLabel(
  row: Pick<TransactionIndexDates, 'expected_close_date' | 'actual_close_date'>,
  today: string
): { text: string; tone: 'done' | 'overdue' | 'soon' | 'later' } | null {
  if (row.actual_close_date) {
    return { text: `Closed ${row.actual_close_date}`, tone: 'done' };
  }
  if (!row.expected_close_date) return null;
  if (row.expected_close_date < today) {
    return {
      text: `Close date passed (${row.expected_close_date})`,
      tone: 'overdue',
    };
  }
  const soon = daysBetweenKeys(today, row.expected_close_date) <= 7;
  return {
    text: `Closes ${row.expected_close_date}`,
    tone: soon ? 'soon' : 'later',
  };
}

function daysBetweenKeys(from: string, to: string): number {
  const a = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10))
  );
  const b = Date.UTC(
    Number(to.slice(0, 4)),
    Number(to.slice(5, 7)) - 1,
    Number(to.slice(8, 10))
  );
  return Math.round((b - a) / 86_400_000);
}

/** Close date: soonest expected close first, dated before undated,
 *  already-closed last. Recent: the index's own order. */
export function sortIndexRows<T extends TransactionIndexDates>(
  rows: readonly T[],
  sort: RecordsSort
): T[] {
  if (sort === 'updated') return [...rows];
  return [...rows].sort((a, b) => {
    const aClosed = Boolean(a.actual_close_date);
    const bClosed = Boolean(b.actual_close_date);
    if (aClosed !== bClosed) return aClosed ? 1 : -1;
    if (a.expected_close_date && b.expected_close_date) {
      return (
        a.expected_close_date.localeCompare(b.expected_close_date) ||
        b.updated_at.localeCompare(a.updated_at)
      );
    }
    if (Boolean(a.expected_close_date) !== Boolean(b.expected_close_date)) {
      return a.expected_close_date ? -1 : 1;
    }
    return b.updated_at.localeCompare(a.updated_at);
  });
}
