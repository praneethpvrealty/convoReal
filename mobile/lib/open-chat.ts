import { router } from 'expo-router';

import { useAuthStore } from '@/lib/auth-store';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import type { Contact } from '@/lib/types';

export interface OpenChatOutcome {
  ok: boolean;
  error?: string;
}

/** Open the Engine inbox thread for a contact — the latest conversation,
 *  or create one first (same insert as the web's handleWhatsAppClick)
 *  when the contact has never been messaged. Failures come back for the
 *  caller to surface: this runs outside any component, so it has no
 *  tree of its own to render a dialog into. */
export async function openContactChat(
  // Only the id is used, so this takes the id rather than a whole
  // Contact row — callers that hold a partial (a viewer, a search hit)
  // should not have to fabricate one.
  contact: Pick<Contact, 'id'>,
  opts?: { draftText?: string }
): Promise<OpenChatOutcome> {
  haptic.tap();
  const draftParam = opts?.draftText
    ? `?draftText=${encodeURIComponent(opts.draftText)}`
    : '';
  const existing = await findThread(contact.id);
  if (existing) {
    router.push(`/(app)/conversation/${existing}${draftParam}`);
    return { ok: true };
  }
  const { profile, session } = useAuthStore.getState();
  if (!profile?.account_id) return { ok: false };
  const { data: conv, error } = await supabase
    .from('conversations')
    .insert({
      account_id: profile.account_id,
      user_id: session?.user.id,
      contact_id: contact.id,
    })
    .select('id')
    .single();
  if (error) {
    // Lost the race against another creator — migration 229's
    // conversations_account_contact_unique means the winner's thread
    // is the answer, not a failure to report.
    const raced = error.code === '23505' ? await findThread(contact.id) : null;
    if (!raced) {
      haptic.warn();
      return { ok: false, error: friendlyError(error.message) };
    }
    router.push(`/(app)/conversation/${raced}${draftParam}`);
    return { ok: true };
  }
  queryClient.invalidateQueries({ queryKey: ['conversations'] });
  router.push(`/(app)/conversation/${conv.id}${draftParam}`);
  return { ok: true };
}

async function findThread(contactId: string): Promise<string | null> {
  const { data } = await supabase
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}
