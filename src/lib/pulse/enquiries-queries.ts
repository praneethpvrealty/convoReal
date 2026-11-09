import type { SupabaseClient } from '@supabase/supabase-js';
import {
  PULSE_ENQUIRY_PAGE_SIZE,
  pulseEnquiryCountsSince,
  tallyPulseEnquiryCounts,
  type PulseEnquiryCursor,
  type PulseEnquiryKind,
  type PulseEnquiryRow,
} from './enquiries';

export async function loadPulseEnquiries(
  db: SupabaseClient,
  accountId: string,
  cursor: PulseEnquiryCursor | null = null,
  kind: PulseEnquiryKind | null = null
): Promise<PulseEnquiryRow[]> {
  const { data, error } = await db.rpc('pulse_enquiries', {
    p_account_id: accountId,
    p_before: cursor?.before ?? null,
    p_before_id: cursor?.beforeId ?? null,
    p_limit: PULSE_ENQUIRY_PAGE_SIZE,
    p_kind: kind,
  });
  if (error) throw error;
  return (data ?? []) as PulseEnquiryRow[];
}

export async function loadPulseEnquiryCounts(
  db: SupabaseClient,
  accountId: string
): Promise<Record<PulseEnquiryKind, number>> {
  const { data, error } = await db.rpc('pulse_enquiry_counts', {
    p_account_id: accountId,
    p_since: pulseEnquiryCountsSince(),
  });
  if (error) throw error;
  return tallyPulseEnquiryCounts(
    (data ?? []) as Array<{ kind: string; total: number | string }>
  );
}
