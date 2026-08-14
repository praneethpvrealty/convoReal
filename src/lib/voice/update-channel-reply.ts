import type { SupabaseClient } from '@supabase/supabase-js';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import {
  parseUpdateChannelReplyId,
  updateChannelConfirmation,
} from './announcements';

/**
 * A contact tapped one of the "how would you like updates?" buttons
 * (updch:* reply ids, minted by /api/contacts/[id]/ask-update-channel).
 * Stores the choice on the contact and confirms it in the thread.
 * Returns true when the reply was one of ours and was handled — the
 * webhook then stops routing it to the chatbot.
 */
export async function handleUpdateChannelReply(args: {
  admin: SupabaseClient;
  accountId: string;
  replyId: string;
  senderPhone: string;
}): Promise<boolean> {
  const channel = parseUpdateChannelReplyId(args.replyId);
  if (!channel) return false;

  const digits = args.senderPhone.replace(/\D/g, '');
  const suffix = digits.length >= 10 ? digits.slice(-10) : digits;
  if (!suffix) return false;

  const { data: contact } = await args.admin
    .from('contacts')
    .select('id')
    .eq('account_id', args.accountId)
    .eq('is_merged', false)
    .ilike('phone', `%${suffix}`)
    .limit(1)
    .maybeSingle();
  if (!contact) return false;

  const { data: updated } = await args.admin
    .from('contacts')
    .update({ preferred_update_channel: channel })
    .eq('id', contact.id)
    .select('id');
  if (!updated?.length) return false;

  await sendWhatsAppMessageAndPersist({
    accountId: args.accountId,
    contactId: contact.id,
    kind: 'text',
    senderType: 'bot',
    text: updateChannelConfirmation(channel),
  });
  return true;
}
