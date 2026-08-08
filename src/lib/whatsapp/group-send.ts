/**
 * Sending into a WhatsApp group.
 *
 * Deliberately NOT routed through meta-api-dispatcher.ts. That path is
 * built around a contact: it resolves and repairs phone numbers, checks
 * the chain-only gate, dedupes against recent sends to the same person
 * and books credits per recipient. A group has no contact to do any of
 * that with — the recipient is a group id — so forcing it through would
 * mean disabling half the dispatcher for one branch and leaving the
 * next reader to work out which half.
 *
 * What a group send still shares with a 1:1 send is the part that
 * matters: the same Meta client, the same messages row, the same
 * conversation preview update.
 *
 * The 24-hour customer service window does NOT apply here. Group
 * messaging is priced per message rather than per conversation window,
 * and there is no single "last inbound from the contact" to measure a
 * window against.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { storagePublicUrl } from '@/lib/storage/url';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  sendMediaMessage,
  sendTextMessage,
  type MediaKind,
} from '@/lib/whatsapp/meta-api';
import { groupIsSendable, refuseGroupSend } from '@/lib/whatsapp/groups';

export interface GroupSendArgs {
  accountId: string;
  /** Our `whatsapp_groups.id`, not Meta's group id. */
  groupId: string;
  senderType: 'agent' | 'user' | 'bot';
  userId?: string | null;
  kind: 'text' | 'media';
  text?: string | null;
  mediaKind?: MediaKind | null;
  mediaLink?: string | null;
  mediaCaption?: string | null;
  mediaFilename?: string | null;
  /** Meta wamid of a message in the same group. */
  contextMessageId?: string | null;
  /** Our messages.id for that same quoted message. */
  replyToMessageId?: string | null;
}

export interface GroupSendResult {
  success: boolean;
  messageId?: string;
  whatsappMessageId?: string;
  error?: string;
}

export async function sendGroupMessage(
  args: GroupSendArgs,
): Promise<GroupSendResult> {
  const refusal = refuseGroupSend(args.kind);
  if (refusal) return { success: false, error: refusal };

  const db = supabaseAdmin();

  // Service-role client, so the account scope is enforced here rather
  // than by RLS — a group id from another account must not resolve.
  const { data: group } = await db
    .from('whatsapp_groups')
    .select('id, wa_group_id, status, subject')
    .eq('id', args.groupId)
    .eq('account_id', args.accountId)
    .maybeSingle();

  if (!group) return { success: false, error: 'Group not found' };
  if (!group.wa_group_id) {
    // Creation is asynchronous; until the lifecycle webhook lands there
    // is no id to address.
    return {
      success: false,
      error: 'This group is still being created on WhatsApp — try again shortly.',
    };
  }
  if (!groupIsSendable(group.status)) {
    return {
      success: false,
      error:
        group.status === 'suspended'
          ? 'WhatsApp has suspended this group, so messages cannot be sent to it.'
          : 'This group is not active.',
    };
  }

  const { data: config } = await db
    .from('whatsapp_config')
    .select('phone_number_id, access_token, groups_enabled')
    .eq('account_id', args.accountId)
    .maybeSingle();

  if (!config) return { success: false, error: 'WhatsApp not configured.' };
  if (!config.groups_enabled) {
    return {
      success: false,
      error:
        'Groups are not enabled for this number. The Groups API requires an Official Business Account.',
    };
  }

  const { data: conversation } = await db
    .from('conversations')
    .select('id')
    .eq('group_id', group.id)
    .maybeSingle();

  if (!conversation) {
    return { success: false, error: 'Group conversation not found' };
  }

  const accessToken = decrypt(config.access_token);

  let waMessageId: string;
  try {
    if (args.kind === 'media') {
      if (!args.mediaKind || !args.mediaLink) {
        return { success: false, error: 'mediaKind and mediaLink are required' };
      }
      const result = await sendMediaMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: group.wa_group_id,
        recipientType: 'group',
        kind: args.mediaKind,
        link: storagePublicUrl(args.mediaLink),
        caption: args.mediaCaption || undefined,
        filename: args.mediaFilename || undefined,
        contextMessageId: args.contextMessageId || undefined,
      });
      waMessageId = result.messageId;
    } else {
      if (!args.text?.trim()) {
        return { success: false, error: 'text is required' };
      }
      const result = await sendTextMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: group.wa_group_id,
        recipientType: 'group',
        text: args.text,
        contextMessageId: args.contextMessageId || undefined,
      });
      waMessageId = result.messageId;
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Meta send failed',
    };
  }

  const contentType = args.kind === 'media' ? args.mediaKind || 'document' : 'text';
  const contentText =
    args.kind === 'media' ? args.mediaCaption || null : args.text || null;

  const { data: inserted, error: insertError } = await db
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      sender_type: args.senderType,
      content_type: contentType,
      content_text: contentText,
      media_url:
        args.kind === 'media' && args.mediaLink
          ? storagePublicUrl(args.mediaLink)
          : null,
      message_id: waMessageId,
      status: 'sent',
      reply_to_message_id: args.replyToMessageId || null,
    })
    .select('id')
    .single();

  if (insertError) {
    // Meta already has it; reporting failure would invite a resend that
    // sends it twice.
    console.error('[group-send] sent but DB insert failed:', insertError.message);
    return {
      success: true,
      whatsappMessageId: waMessageId,
      error: 'Sent, but not recorded in the inbox.',
    };
  }

  await db
    .from('conversations')
    .update({
      last_message_text:
        contentText?.trim() || (args.kind === 'media' ? `[${contentType}]` : ''),
      last_message_at: new Date().toISOString(),
    })
    .eq('id', conversation.id);

  return {
    success: true,
    messageId: inserted.id,
    whatsappMessageId: waMessageId,
  };
}
