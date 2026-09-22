import { apiFetch } from './api';
import { supabase } from './supabase';
import type { RequirementRow } from './requirements-feed';

export async function fetchRequirements(): Promise<RequirementRow[]> {
  const rows = await apiFetch<RequirementRow[]>('/api/requirements');
  return Array.isArray(rows) ? rows : [];
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
