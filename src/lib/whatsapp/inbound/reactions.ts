import { supabaseAdmin } from '@/lib/supabase/admin';
import type { WhatsAppMessage } from '@/lib/whatsapp/webhook-handler';

export async function lookupInternalIdByMetaId(
  metaId: string,
  conversationId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('message_id', metaId)
    .eq('conversation_id', conversationId)
    .maybeSingle();
  if (error) {
    console.error('[webhook] lookupInternalIdByMetaId failed:', error.message);
    return null;
  }
  return data?.id ?? null;
}

export async function handleReaction(
  message: WhatsAppMessage,
  conversationId: string,
  contactId: string
) {
  const reaction = message.reaction;
  if (!reaction?.message_id) return;

  const targetInternalId = await lookupInternalIdByMetaId(
    reaction.message_id,
    conversationId
  );
  if (!targetInternalId) {
    console.warn(
      '[webhook] reaction target message not found; skipping',
      reaction.message_id
    );
    return;
  }

  if (!reaction.emoji) {
    const { error: delError } = await supabaseAdmin()
      .from('message_reactions')
      .delete()
      .eq('message_id', targetInternalId)
      .eq('actor_type', 'customer')
      .eq('actor_id', contactId);
    if (delError) {
      console.error('[webhook] reaction delete failed:', delError.message);
    }
    return;
  }

  const { error: upsertError } = await supabaseAdmin()
    .from('message_reactions')
    .upsert(
      {
        message_id: targetInternalId,
        conversation_id: conversationId,
        actor_type: 'customer',
        actor_id: contactId,
        emoji: reaction.emoji,
      },
      { onConflict: 'message_id,actor_type,actor_id' }
    );
  if (upsertError) {
    console.error('[webhook] reaction upsert failed:', upsertError.message);
  }
}
