import type { SupabaseClient } from '@supabase/supabase-js';

import { ilikeAcross, ilikeTerm } from '@/lib/v1/query';
import type { RadarManualContact } from '@/types';

const CONTACT_COLUMNS =
  'id, name, second_name, name_tag, phone, classification';

export interface EligibleRadarContactQuery {
  ids?: string[];
  query?: string;
  limit?: number;
}

/**
 * Existing live Buyers/Agents that may receive a manually widened Radar
 * alert. Every caller uses the same tenant, lifecycle and consent rules,
 * including the send route so a crafted client cannot bypass the picker.
 */
export async function loadEligibleRadarContacts(
  db: SupabaseClient,
  accountId: string,
  opts: EligibleRadarContactQuery = {}
): Promise<RadarManualContact[]> {
  const ids = [...new Set(opts.ids ?? [])].slice(0, 20);
  if (opts.ids && ids.length === 0) return [];

  let request = db
    .from('contacts')
    .select(CONTACT_COLUMNS)
    .eq('account_id', accountId)
    .eq('status', 'active')
    .in('classification', ['Buyer', 'Agent'])
    .eq('is_dead', false)
    .eq('is_archived', false)
    .eq('is_merged', false)
    .not('phone', 'is', null)
    .or('chain_only.is.null,chain_only.eq.false')
    .or('requirement_active.is.null,requirement_active.eq.true')
    .or('buyer_alerts_consent.is.null,buyer_alerts_consent.neq.declined')
    .order('name', { ascending: true })
    .limit(Math.min(Math.max(opts.limit ?? 12, 1), 20));

  if (ids.length > 0) request = request.in('id', ids);

  const term = opts.query ? ilikeTerm(opts.query) : null;
  if (opts.query && !term) return [];
  if (term) {
    request = request.or(
      ilikeAcross(['name', 'second_name', 'name_tag', 'phone'], term)
    );
  }

  const { data, error } = await request;
  if (error) throw error;

  return (data ?? []).filter(
    (row): row is RadarManualContact =>
      typeof row.id === 'string' &&
      typeof row.phone === 'string' &&
      row.phone.trim().length > 0 &&
      (row.classification === 'Buyer' || row.classification === 'Agent')
  );
}
