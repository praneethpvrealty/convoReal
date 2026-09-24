import { apiFetch } from './api';
import { rankContactSearchResults } from './contact-search-rank';
import { supabase } from './supabase';
import {
  REQUIREMENT_CONTACT_COLUMNS,
  REQUIREMENT_EDITABLE_CLASSIFICATIONS,
  requirementContactSearchFilter,
  type RequirementRow,
} from './requirements-feed';

export async function fetchRequirements(): Promise<RequirementRow[]> {
  const rows = await apiFetch<RequirementRow[]>('/api/requirements');
  return Array.isArray(rows) ? rows : [];
}

/** Whose requirement this could be, hydrated so the brief the sheet
 *  opens on is the one already on record. */
export async function searchRequirementContacts(
  query: string
): Promise<RequirementRow[]> {
  const term = query.trim();
  let request = supabase
    .from('contacts')
    .select(REQUIREMENT_CONTACT_COLUMNS.join(', '))
    .eq('is_merged', false)
    .eq('chain_only', false)
    .in('classification', REQUIREMENT_EDITABLE_CLASSIFICATIONS)
    .limit(50);

  if (term) {
    request = request.or(requirementContactSearchFilter(term));
  }

  const { data, error } = await request;
  if (error) throw error;
  const rows = (data ?? []) as unknown as RequirementRow[];
  return term
    ? (rankContactSearchResults(rows, term) as RequirementRow[])
    : rows;
}

export async function setRequirementActive(
  contactId: string,
  active: boolean
): Promise<void> {
  const { data, error } = await supabase
    .from('contacts')
    .update({
      requirement_active: active,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contactId)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('That contact is no longer there.');
  }
}

export async function attachSuggestedTag(
  contactId: string,
  accountId: string,
  userId: string,
  name: string
): Promise<void> {
  const existing = await supabase
    .from('tags')
    .select('id')
    .eq('account_id', accountId)
    .ilike('name', name)
    .limit(1)
    .maybeSingle();
  if (existing.error) throw existing.error;

  let tagId = existing.data?.id as string | undefined;
  if (!tagId) {
    const created = await supabase
      .from('tags')
      .insert({ user_id: userId, account_id: accountId, name })
      .select('id')
      .single();
    if (created.error) throw created.error;
    tagId = created.data.id as string;
  }

  const { error } = await supabase
    .from('contact_tags')
    .insert({ contact_id: contactId, tag_id: tagId });
  if (error) throw error;
}
