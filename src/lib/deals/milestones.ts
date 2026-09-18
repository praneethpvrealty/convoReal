/**
 * Milestone templates and status rules for the Transaction Workspace.
 *
 * A milestone is a checklist item on the closing record. It is NOT a
 * pipeline stage: completing one never moves the deal's card, and
 * moving the card never completes one. The two answer different
 * questions — "where is this deal on the board" versus "what has been
 * done" — and src/lib/deals/milestones.test.ts pins that nothing in
 * this module can reach a stage.
 */

import { isDealVisibility, type DealVisibility } from './visibility';

export type DealMilestoneStatus =
  'pending' | 'in_progress' | 'completed' | 'skipped';

export const DEAL_MILESTONE_STATUSES: readonly DealMilestoneStatus[] = [
  'pending',
  'in_progress',
  'completed',
  'skipped',
];

/** Mirrored in mobile/lib/deal-workspace.ts; guarded by mobile-parity.test.ts. */
export const DEAL_MILESTONE_STATUS_LABELS: Record<DealMilestoneStatus, string> =
  {
    pending: 'Pending',
    in_progress: 'In progress',
    completed: 'Completed',
    skipped: 'Skipped',
  };

export interface DealMilestoneTemplate {
  key: string;
  title: string;
}

/** The standard Indian resale closing, in order. Instantiated per deal
 *  and then customised there; editing this list never rewrites a deal
 *  that already has its milestones. */
export const DEAL_MILESTONE_TEMPLATES: readonly DealMilestoneTemplate[] = [
  { key: 'initial_negotiation', title: 'Initial negotiation' },
  { key: 'commercial_terms_agreed', title: 'Commercial terms agreed' },
  { key: 'token_paid', title: 'Token paid' },
  { key: 'documents_collected', title: 'Documents collected' },
  { key: 'legal_verification', title: 'Legal verification' },
  { key: 'loan_processing', title: 'Loan processing / sanction' },
  { key: 'draft_agreement_shared', title: 'Draft agreement shared' },
  { key: 'agreement_executed', title: 'Agreement executed' },
  { key: 'conditions_precedent', title: 'Conditions precedent completed' },
  { key: 'tds_and_instruments', title: 'TDS and payment instruments prepared' },
  { key: 'registration_scheduled', title: 'Registration scheduled' },
  { key: 'sale_deed_registered', title: 'Sale deed registered' },
  { key: 'possession_handover', title: 'Possession / handover' },
  { key: 'brokerage_collected', title: 'Brokerage collected' },
  { key: 'deal_closed', title: 'Deal closed' },
];

export interface DealMilestone {
  id: string;
  account_id: string;
  deal_id: string;
  template_key: string | null;
  title: string;
  position: number;
  status: DealMilestoneStatus;
  target_date: string | null;
  completed_at: string | null;
  owner_id: string | null;
  notes: string | null;
  visibility: DealVisibility;
  created_at: string;
  updated_at: string;
}

export function isDealMilestoneStatus(v: unknown): v is DealMilestoneStatus {
  return (
    typeof v === 'string' &&
    (DEAL_MILESTONE_STATUSES as readonly string[]).includes(v)
  );
}

/** Rows to insert when a deal gets the standard checklist. Skips any
 *  template key already present so re-running is safe. */
export function standardMilestoneRows(
  accountId: string,
  dealId: string,
  existingKeys: Iterable<string | null> = []
): Array<{
  account_id: string;
  deal_id: string;
  template_key: string;
  title: string;
  position: number;
}> {
  const present = new Set(
    Array.from(existingKeys).filter((k): k is string => Boolean(k))
  );
  return DEAL_MILESTONE_TEMPLATES.filter((t) => !present.has(t.key)).map(
    (t, idx) => ({
      account_id: accountId,
      deal_id: dealId,
      template_key: t.key,
      title: t.title,
      position: idx,
    })
  );
}

export interface MilestoneProgress {
  total: number;
  done: number;
  next: Pick<DealMilestone, 'title' | 'target_date'> | null;
}

export function milestoneProgress(
  milestones: readonly Pick<
    DealMilestone,
    'status' | 'position' | 'title' | 'target_date'
  >[]
): MilestoneProgress {
  const done = milestones.filter(
    (m) => m.status === 'completed' || m.status === 'skipped'
  ).length;
  const next =
    [...milestones]
      .filter((m) => m.status === 'pending' || m.status === 'in_progress')
      .sort((a, b) => a.position - b.position)[0] ?? null;
  return {
    total: milestones.length,
    done,
    next: next ? { title: next.title, target_date: next.target_date } : null,
  };
}

export interface MilestonePatch {
  title?: string;
  status?: DealMilestoneStatus;
  target_date?: string | null;
  owner_id?: string | null;
  notes?: string | null;
  visibility?: DealVisibility;
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnly(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v === 'string' && DATE_ONLY.test(v)) return v;
  return undefined;
}

export function parseMilestonePatch(raw: unknown): ParseResult<MilestonePatch> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Nothing to update' };
  }
  const input = raw as Record<string, unknown>;
  const patch: MilestonePatch = {};

  if (input.title !== undefined) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title || title.length > 120) {
      return { ok: false, error: 'Title must be 1–120 characters' };
    }
    patch.title = title;
  }
  if (input.status !== undefined) {
    if (!isDealMilestoneStatus(input.status)) {
      return { ok: false, error: 'Unknown milestone status' };
    }
    patch.status = input.status;
  }
  if (input.target_date !== undefined) {
    const date = parseDateOnly(input.target_date);
    if (date === undefined) {
      return { ok: false, error: 'target_date must be YYYY-MM-DD' };
    }
    patch.target_date = date;
  }
  if (input.owner_id !== undefined) {
    patch.owner_id =
      typeof input.owner_id === 'string' && input.owner_id.trim()
        ? input.owner_id.trim()
        : null;
  }
  if (input.notes !== undefined) {
    const notes = typeof input.notes === 'string' ? input.notes.trim() : '';
    if (notes.length > 2000) {
      return { ok: false, error: 'Notes must be 2,000 characters or less' };
    }
    patch.notes = notes || null;
  }
  if (input.visibility !== undefined) {
    if (!isDealVisibility(input.visibility)) {
      return { ok: false, error: 'Unknown visibility' };
    }
    patch.visibility = input.visibility;
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'Nothing to update' };
  }
  return { ok: true, value: patch };
}

/** What the row update carries: `completed_at` follows the status so
 *  the timeline can say when, and clears when a milestone reopens. */
export function milestoneUpdateData(
  patch: MilestonePatch,
  now: Date = new Date()
): Record<string, unknown> {
  const data: Record<string, unknown> = { ...patch };
  if (patch.status === 'completed') {
    data.completed_at = now.toISOString();
  } else if (patch.status !== undefined) {
    data.completed_at = null;
  }
  return data;
}
