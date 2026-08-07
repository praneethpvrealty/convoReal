// Data layer for the portal-lead re-engagement outcome report.
//
// Every read goes through a SECURITY DEFINER RPC (migration 212) that
// aggregates in SQL and names its account explicitly — the funnel spans
// four tables and assembling it client-side would mean an unbounded
// contact-id list in `.in()` filters.
//
// `broadcastId` selects one batch; null spans every re-engagement batch
// the account has ever sent, which is what the standing view shows.

import type { SupabaseClient } from '@supabase/supabase-js';

type DB = SupabaseClient;

/** Rows per page in the leads table. */
export const LEADS_PAGE_SIZE = 100;

export interface ReengagementSummary {
  batches: number;
  leads: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  requirementUpdated: number;
  matched: number;
  failed: number;
}

export interface ReengagementLead {
  contactId: string;
  contactName: string | null;
  contactPhone: string | null;
  broadcastId: string;
  broadcastName: string | null;
  batchSentAt: string;
  status: string;
  repliedAt: string | null;
  requirementUpdatedAt: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  areas: string[];
  /** Null when Radar has produced no match event for this lead yet. */
  matchEventId: string | null;
  matchCount: number;
  matchEventStatus: string | null;
}

export interface ReengagementBatch {
  broadcastId: string;
  name: string | null;
  sentAt: string;
  status: string | null;
  totalRecipients: number;
}

interface SummaryRow {
  batch_count: number;
  lead_count: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  replied_count: number;
  requirement_updated_count: number;
  matched_count: number;
  failed_count: number;
}

interface LeadRow {
  contact_id: string;
  contact_name: string | null;
  contact_phone: string | null;
  broadcast_id: string;
  broadcast_name: string | null;
  batch_sent_at: string;
  status: string;
  replied_at: string | null;
  requirement_updated_at: string | null;
  budget_min: number | string | null;
  budget_max: number | string | null;
  areas: string[] | null;
  match_event_id: string | null;
  match_count: number;
  match_event_status: string | null;
  total_count: number;
}

interface BatchRow {
  broadcast_id: string;
  broadcast_name: string | null;
  sent_at: string;
  status: string | null;
  total_recipients: number | null;
}

const EMPTY_SUMMARY: ReengagementSummary = {
  batches: 0,
  leads: 0,
  sent: 0,
  delivered: 0,
  read: 0,
  replied: 0,
  requirementUpdated: 0,
  matched: 0,
  failed: 0,
};

/** Postgres NUMERIC arrives as a string over PostgREST. */
function num(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

export async function loadReengagementSummary(
  db: DB,
  accountId: string,
  broadcastId: string | null = null
): Promise<ReengagementSummary> {
  const { data, error } = await db
    .rpc('reengagement_summary', {
      p_account_id: accountId,
      p_broadcast_id: broadcastId,
    })
    .maybeSingle<SummaryRow>();
  if (error) throw error;
  if (!data) return EMPTY_SUMMARY;

  return {
    batches: data.batch_count ?? 0,
    leads: data.lead_count ?? 0,
    sent: data.sent_count ?? 0,
    delivered: data.delivered_count ?? 0,
    read: data.read_count ?? 0,
    replied: data.replied_count ?? 0,
    requirementUpdated: data.requirement_updated_count ?? 0,
    matched: data.matched_count ?? 0,
    failed: data.failed_count ?? 0,
  };
}

export async function loadReengagementLeads(
  db: DB,
  accountId: string,
  opts: {
    broadcastId?: string | null;
    onlyMatched?: boolean;
    page?: number;
    pageSize?: number;
  } = {}
): Promise<{ leads: ReengagementLead[]; total: number }> {
  const pageSize = opts.pageSize ?? LEADS_PAGE_SIZE;
  const page = Math.max(0, opts.page ?? 0);

  const { data, error } = await db.rpc('reengagement_leads', {
    p_account_id: accountId,
    p_broadcast_id: opts.broadcastId ?? null,
    p_only_matched: opts.onlyMatched ?? false,
    p_limit: pageSize,
    p_offset: page * pageSize,
  });
  if (error) throw error;

  const rows = (data ?? []) as LeadRow[];
  return {
    // total_count is the pre-pagination count, repeated on every row.
    total: rows[0]?.total_count ?? 0,
    leads: rows.map((r) => ({
      contactId: r.contact_id,
      contactName: r.contact_name,
      contactPhone: r.contact_phone,
      broadcastId: r.broadcast_id,
      broadcastName: r.broadcast_name,
      batchSentAt: r.batch_sent_at,
      status: r.status,
      repliedAt: r.replied_at,
      requirementUpdatedAt: r.requirement_updated_at,
      budgetMin: num(r.budget_min),
      budgetMax: num(r.budget_max),
      areas: r.areas ?? [],
      matchEventId: r.match_event_id,
      matchCount: r.match_count ?? 0,
      matchEventStatus: r.match_event_status,
    })),
  };
}

export async function loadReengagementBatches(
  db: DB,
  accountId: string
): Promise<ReengagementBatch[]> {
  const { data, error } = await db.rpc('reengagement_batches', {
    p_account_id: accountId,
  });
  if (error) throw error;

  return ((data ?? []) as BatchRow[]).map((r) => ({
    broadcastId: r.broadcast_id,
    name: r.broadcast_name,
    sentAt: r.sent_at,
    status: r.status,
    totalRecipients: r.total_recipients ?? 0,
  }));
}
