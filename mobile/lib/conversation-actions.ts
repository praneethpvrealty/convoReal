import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import type { ConversationStatus } from '@/lib/types';

// Conversation queue-state actions shared by the thread header menu and
// the inbox swipe action. Mirror the web inbox: a plain update on the
// conversations row (RLS scopes it to the account), then refresh the
// lists. Deleting a conversation isn't supported server-side — archiving
// hides it while preserving the message history.

function refresh(id?: string) {
  queryClient.invalidateQueries({ queryKey: ['conversations'] });
  if (id) queryClient.invalidateQueries({ queryKey: ['conversation', id] });
}

export async function setConversationStatus(
  id: string,
  status: ConversationStatus
): Promise<void> {
  const { error } = await supabase.from('conversations').update({ status }).eq('id', id);
  if (error) throw new Error(error.message);
  refresh(id);
}

export async function setConversationArchived(id: string, archived: boolean): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .update({ is_archived: archived })
    .eq('id', id);
  if (error) throw new Error(error.message);
  refresh(id);
}
