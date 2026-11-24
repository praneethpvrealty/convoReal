import {
  eventContactIds,
  suggestDealsForEvent,
  type EventForDeal,
} from '@shared/lib/deals/participants';

import { supabase } from './supabase';

/**
 * Deals to offer when connecting a calendar event to a deal. Web
 * parity: src/lib/deals/event-deal-options.ts. The ranking is the
 * shared `suggestDealsForEvent`; only the fetch is written twice.
 */

export interface DealOption {
  id: string;
  title: string;
  contact_id: string | null;
  property_id: string | null;
  status: string | null;
  updated_at: string | null;
  contact?: { name: string | null } | null;
  property?: { title: string | null } | null;
}

const DEAL_OPTION_COLUMNS =
  'id, title, contact_id, property_id, status, updated_at, contact:contacts(name), property:properties(title)';

export async function fetchDealsForEvent(
  event: EventForDeal
): Promise<DealOption[]> {
  const contactIds = eventContactIds(event).slice(0, 12);
  const filters = [
    event.property_id ? `property_id.eq.${event.property_id}` : null,
    contactIds.length ? `contact_id.in.(${contactIds.join(',')})` : null,
  ].filter(Boolean);
  if (filters.length === 0) return [];

  const [direct, viaStakeholder] = await Promise.all([
    supabase
      .from('deals')
      .select(DEAL_OPTION_COLUMNS)
      .or(filters.join(','))
      .order('updated_at', { ascending: false })
      .limit(20),
    contactIds.length
      ? supabase
          .from('deal_stakeholders')
          .select('deal_id, contact_id')
          .in('contact_id', contactIds)
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (direct.error) throw direct.error;

  const deals = (direct.data ?? []) as unknown as DealOption[];
  const stakeholderContacts: Record<string, string[]> = {};
  for (const row of (viaStakeholder.data ?? []) as {
    deal_id: string;
    contact_id: string;
  }[]) {
    (stakeholderContacts[row.deal_id] ??= []).push(row.contact_id);
  }
  const missing = Object.keys(stakeholderContacts).filter(
    (id) => !deals.some((d) => d.id === id)
  );
  if (missing.length > 0) {
    const { data } = await supabase
      .from('deals')
      .select(DEAL_OPTION_COLUMNS)
      .in('id', missing);
    deals.push(...((data ?? []) as unknown as DealOption[]));
  }
  return suggestDealsForEvent(deals, event, stakeholderContacts).slice(0, 6);
}

export async function searchDeals(term: string): Promise<DealOption[]> {
  const cleaned = term.trim().replace(/[%,()]/g, ' ');
  if (cleaned.length < 2) return [];
  const { data, error } = await supabase
    .from('deals')
    .select(DEAL_OPTION_COLUMNS)
    .ilike('title', `%${cleaned}%`)
    .order('updated_at', { ascending: false })
    .limit(8);
  if (error) throw error;
  return (data ?? []) as unknown as DealOption[];
}

export function dealOptionDetail(deal: DealOption): string {
  return [
    deal.contact?.name,
    deal.property?.title,
    deal.status && deal.status !== 'open' ? deal.status : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
