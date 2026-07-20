import { router } from 'expo-router';
import { Alert } from 'react-native';

import { useAuthStore } from '@/lib/auth-store';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import type { Contact } from '@/lib/types';

/** Open the CRM inbox thread for a contact — the latest conversation,
 *  or create one first (same insert as the web's handleWhatsAppClick)
 *  when the contact has never been messaged. */
export async function openContactChat(contact: Contact) {
  haptic.tap();
  const { data } = await supabase
    .from('conversations')
    .select('id')
    .eq('contact_id', contact.id)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.id) {
    router.push(`/(app)/conversation/${data.id}`);
    return;
  }
  const { profile, session } = useAuthStore.getState();
  if (!profile?.account_id) return;
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
    haptic.warn();
    Alert.alert('Could not open thread', friendlyError(error.message));
    return;
  }
  queryClient.invalidateQueries({ queryKey: ['conversations'] });
  router.push(`/(app)/conversation/${conv.id}`);
}
