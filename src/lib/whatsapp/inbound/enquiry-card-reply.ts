import { resolveConversation } from '@/lib/conversations/resolve';
import { sendSubjectPhotos } from '@/lib/ai/photo-request';
import {
  buildEnquiryRejectText,
  parseEnquiryReply,
  resolveEnquiryTeamPhone,
} from '@/lib/whatsapp/enquiry-card';
import { unavailableListingReplyWithShowcase } from '@/lib/inventory/unavailable-reply';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { handlePropertyShareYesReply } from '@/lib/whatsapp/inbound/property-share-replies';

/**
 * Acts on an enquiry-card tap.
 *
 * Every branch resolves the BUYER's conversation first: the tap came
 * from the agent's thread, and sending the photos into that thread
 * would deliver them to the agent who already has them. Returns true
 * when the tap was consumed, so the agent's own message never falls
 * through to the owner chatbot underneath it.
 */
export async function handleEnquiryCardReply(
  action: ReturnType<typeof parseEnquiryReply> & object,
  accountId: string,
  configOwnerUserId: string,
  /** The AGENT's own thread — where the tap arrived, and where the
   *  outcome is confirmed, the same way the location card answers
   *  "Approved — ConvoReal has sent the exact location...". */
  agentThread: { contactId: string; conversationId: string }
): Promise<boolean> {
  const admin = supabaseAdmin();

  const { data: lead } = await admin
    .from('contacts')
    .select('id, name, phone')
    .eq('id', action.contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!lead?.phone) return false;

  const confirmToAgent = async (text: string) => {
    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId: agentThread.contactId,
      conversationId: agentThread.conversationId,
      kind: 'text',
      senderType: 'bot',
      text,
    });
  };

  const { data: propertyRow } = await admin
    .from('properties')
    .select('title, status')
    .eq('id', action.propertyId)
    .eq('account_id', accountId)
    .maybeSingle();
  const propertyLabel = propertyRow?.title
    ? `*${propertyRow.title}*`
    : 'the listing';

  // Reject and "I'll reply" are the agent taking the thread: the
  // conversation is flagged pending so it sits at the top of the inbox
  // for them to answer personally. Reject also closes the bot's side
  // with the buyer — the ack promised them the details "shortly", so
  // instead of going silent it points them at the team's own number.
  // The legacy "I'll answer" button stays fully quiet, as it said.
  if (action.action === 'reject' || action.action === 'mine') {
    await admin
      .from('conversations')
      .update({ status: 'pending', updated_at: new Date().toISOString() })
      .eq('contact_id', action.contactId)
      .eq('account_id', accountId);
    if (action.action === 'reject') {
      const teamPhone = await resolveEnquiryTeamPhone(
        admin,
        accountId,
        configOwnerUserId
      );
      const { conversation: leadConversation } = await resolveConversation<{
        id: string;
      }>(admin, {
        accountId,
        contactId: action.contactId,
        userId: configOwnerUserId,
        columns: 'id',
      });
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: action.contactId,
        ...(leadConversation ? { conversationId: leadConversation.id } : {}),
        toPhone: lead.phone as string,
        kind: 'text',
        senderType: 'bot',
        text: buildEnquiryRejectText(lead.name, propertyRow?.title, teamPhone),
      });
      await confirmToAgent(
        `❌ Rejected — ${lead.name || lead.phone} was asked to reach your team directly${teamPhone ? ` on ${teamPhone}` : ''}. The thread is flagged for you in the inbox.`
      );
    } else {
      await confirmToAgent(
        `❌ Rejected — nothing was sent to ${lead.name || lead.phone}. The thread is flagged for you in the inbox.`
      );
    }
    return true;
  }

  const { conversation } = await resolveConversation<{ id: string }>(admin, {
    accountId,
    contactId: action.contactId,
    userId: configOwnerUserId,
    columns: 'id',
  });
  if (!conversation) return false;

  const unavailableReply = await unavailableListingReplyWithShowcase({
    db: admin,
    accountId,
    contactId: action.contactId,
    contactName: lead.name,
    propertyTitle: propertyRow?.title,
    status: propertyRow?.status,
  });
  if (unavailableReply) {
    const { data: alreadyTold } = await admin
      .from('messages')
      .select('id')
      .eq('conversation_id', conversation.id)
      .eq('content_text', unavailableReply)
      .neq('status', 'failed')
      .limit(1)
      .maybeSingle();
    if (!alreadyTold) {
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: action.contactId,
        conversationId: conversation.id,
        toPhone: lead.phone as string,
        kind: 'text',
        senderType: 'bot',
        text: unavailableReply,
      });
    }
    await confirmToAgent(
      `⚠️ Not sent — ${propertyLabel} is marked "${propertyRow?.status}". ${lead.name || lead.phone} was told it is not available and asked for their requirements and budget.`
    );
    return true;
  }

  if (action.action === 'photos') {
    const sent = await sendSubjectPhotos({
      db: admin,
      accountId,
      userId: configOwnerUserId,
      contactId: action.contactId,
      conversationId: conversation.id,
      propertyIds: [action.propertyId],
      requestText: 'photos',
    });
    if (sent) {
      await confirmToAgent(
        `✅ Photos of ${propertyLabel} sent to ${lead.name || lead.phone} on WhatsApp.`
      );
      return true;
    }
    // No public photos to send — fall through to the details, which is
    // the closest thing to what the buyer asked for.
  }

  // Approve (and the legacy "details" button): the complete details —
  // photo, price, specs, description and the listing link — straight to
  // the buyer's number.
  await handlePropertyShareYesReply(
    action.propertyId,
    accountId,
    configOwnerUserId,
    action.contactId,
    conversation.id,
    lead.phone as string
  );
  await confirmToAgent(
    `✅ Approved — complete details for ${propertyLabel} sent to ${lead.name || lead.phone} on WhatsApp.`
  );
  return true;
}
