import type { SupabaseClient } from '@supabase/supabase-js';
import { daysAgoStart } from '@/lib/dashboard/date-utils';

export interface LeadSourceRow {
  source: string;
  contacts_added: number;
  deals_created: number;
  deals_won: number;
  won_value: number;
}

export interface EmailSyncHealthRow {
  status: 'success' | 'failed' | 'ignored';
  events: number;
  last_at: string | null;
}

export interface LeadSourceSummary {
  sources: number;
  contactsAdded: number;
  dealsCreated: number;
  dealsWon: number;
  wonValue: number;
  topSource: LeadSourceRow | null;
}

export async function loadLeadSourceAnalytics(
  db: SupabaseClient,
  accountId: string,
  days: number
): Promise<LeadSourceRow[]> {
  const { data, error } = await db.rpc('lead_source_analytics', {
    p_account_id: accountId,
    p_start: daysAgoStart(days).toISOString(),
  });
  if (error) throw error;
  return (data ?? []) as LeadSourceRow[];
}

export async function loadEmailSyncHealth(
  db: SupabaseClient,
  accountId: string,
  days: number
): Promise<EmailSyncHealthRow[]> {
  const { data, error } = await db.rpc('email_sync_health', {
    p_account_id: accountId,
    p_start: daysAgoStart(days).toISOString(),
  });
  if (error) throw error;
  return (data ?? []) as EmailSyncHealthRow[];
}

export function conversionRate(
  row: Pick<LeadSourceRow, 'contacts_added' | 'deals_created'>
): number | null {
  if (row.contacts_added === 0) return null;
  return (row.deals_created / row.contacts_added) * 100;
}

export function summarizeLeadSources(rows: LeadSourceRow[]): LeadSourceSummary {
  let contactsAdded = 0;
  let dealsCreated = 0;
  let dealsWon = 0;
  let wonValue = 0;
  let topSource: LeadSourceRow | null = null;

  for (const row of rows) {
    contactsAdded += row.contacts_added;
    dealsCreated += row.deals_created;
    dealsWon += row.deals_won;
    wonValue += Number(row.won_value);
    if (!topSource || row.contacts_added > topSource.contacts_added) {
      topSource = row;
    }
  }

  return {
    sources: rows.length,
    contactsAdded,
    dealsCreated,
    dealsWon,
    wonValue,
    topSource,
  };
}
