import { sendPropertyEnquiryCard } from '@/lib/whatsapp/enquiry-card';
import { createNotification } from '@/lib/notifications/create';
import {
  relayLeadMessageToBridgedAgent,
  BRIDGE_REPLY_HINT,
} from '@/lib/whatsapp/reply-bridge';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { InboundChainContext, StepResult } from '../context';

export async function leadPing(ctx: InboundChainContext): Promise<StepResult> {
  const {
    accountId,
    message,
    senderPhone,
    contentText,
    enquiryPropertyId,
    ownerCheck,
    contactRecord,
    conversation,
    isFirstInboundMessage,
    assignedAgentUserId,
  } = ctx;
  // First message on a brand-new lead thread — alert the assigned agent
  // once (in-app + push + WhatsApp).
  let pingedOnWhatsApp = false;
  if (!ownerCheck.isOwner && isFirstInboundMessage) {
    const preview = (contentText || `[${message.type}]`).slice(0, 140);

    // A first message that names a listing is an enquiry, and an
    // enquiry deserves the card — property, buyer, and the two sends
    // the buyer is asking for — rather than a line of text the agent
    // has to read and act on by hand. Falls back to the plain ping when
    // no listing is named or the card cannot be delivered.
    const cardSent = enquiryPropertyId
      ? await sendPropertyEnquiryCard({
          db: supabaseAdmin(),
          accountId,
          agentUserId: assignedAgentUserId,
          propertyId: enquiryPropertyId,
          contactId: contactRecord.id,
          leadName: contactRecord.name || senderPhone,
          leadPhone: senderPhone,
          enquiryText: preview,
        })
      : false;

    const notified = await createNotification({
      accountId,
      userId: assignedAgentUserId,
      type: 'new_message',
      eventKey: 'first_inbound_message',
      title: `New lead: ${contactRecord.name || senderPhone}`,
      body: preview,
      entityType: 'conversation',
      entityId: conversation.id,
      link: `/inbox?conversation=${conversation.id}`,
      // The card already reached them on WhatsApp; a second message
      // saying the same thing less usefully is noise. The channel is
      // forced off rather than left without a text, because
      // createNotification falls back to title+body on WhatsApp. The
      // in-app and push notifications still go out either way.
      ...(cardSent
        ? { channels: { inApp: true, push: true, whatsapp: false } }
        : {
            whatsappText: [
              '💬 *New lead just messaged you*',
              `👤 ${contactRecord.name || senderPhone}`,
              '',
              preview,
              '',
              BRIDGE_REPLY_HINT,
            ].join('\n'),
          }),
    });
    pingedOnWhatsApp = cardSent || notified.whatsapp?.success === true;
  } else if (!ownerCheck.isOwner && (conversation.unread_count || 0) === 0) {
    // A reply on an existing thread the agent had already caught up on
    // (unread was 0 before this message). Alert them with an in-app +
    // push notification — but not a WhatsApp ping, to avoid messaging
    // the agent for every back-and-forth. Threads that already had
    // unseen messages don't re-notify, so a burst of replies is one ping.
    const preview = (contentText || `[${message.type}]`).slice(0, 140);
    const notified = await createNotification({
      accountId,
      userId: assignedAgentUserId,
      type: 'new_message',
      eventKey: 'inbound_reply',
      title: `${contactRecord.name || senderPhone} replied`,
      body: preview,
      entityType: 'conversation',
      entityId: conversation.id,
      link: `/inbox?conversation=${conversation.id}`,
    });
    pingedOnWhatsApp = notified.whatsapp?.success === true;
  }

  // An agent who answered this lead from their own WhatsApp keeps the
  // conversation there: mirror the lead's message to their phone, ready
  // to be replied to again. Skipped when the notification above already
  // pinged them (that ping is itself answerable), and a no-op for every
  // thread nobody has answered from WhatsApp.
  if (!ownerCheck.isOwner && !pingedOnWhatsApp) {
    await relayLeadMessageToBridgedAgent({
      accountId,
      conversationId: conversation.id,
      leadName: contactRecord.name || senderPhone,
      body: contentText || `[${message.type}]`,
    });
  }

  return 'continue';
}
