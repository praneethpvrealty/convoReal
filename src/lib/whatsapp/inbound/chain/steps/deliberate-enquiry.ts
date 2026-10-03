import {
  buildEnquiryAckText,
  sendPropertyEnquiryCard,
} from '@/lib/whatsapp/enquiry-card';
import {
  appendListingStatusNote,
  unavailableListingReply,
} from '@/lib/inventory/listing-status';
import { createNotification } from '@/lib/notifications/create';
import { BRIDGE_REPLY_HINT } from '@/lib/whatsapp/reply-bridge';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { InboundChainContext, StepResult } from '../context';

export async function deliberateEnquiry(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    message,
    configOwnerUserId,
    senderPhone,
    contentText,
    enquiryPropertyId,
    enquiryIsDeliberate,
    enquiryPropertyTitle,
    enquiryPropertyStatus,
    ownerCheck,
    contactRecord,
    conversation,
    assignedAgentUserId,
  } = ctx;
  // A deliberate enquiry — the property CODE is in the message, which
  // nothing produces except the showcase's Enquire button or a buyer
  // quoting the code on purpose, or the title of a listing that is no
  // longer Available. This is a request for one listing, not
  // a requirement to qualify: the first live tap of the button was
  // answered by the ladder with "what budget range are you working
  // with?" — interrogating a buyer who had just named the exact
  // property — and no card reached the agent, because the card was
  // gated on the contact's first-ever message and this buyer had
  // messaged before. Buyer gets an acknowledgement, the agent gets the
  // Approve/Reject card, and the message is consumed so nothing
  // downstream can talk over the approval.
  if (
    !ownerCheck.isOwner &&
    enquiryPropertyId &&
    enquiryIsDeliberate &&
    message.type === 'text'
  ) {
    const preview = (contentText || '').slice(0, 140);
    const cardSent = await sendPropertyEnquiryCard({
      db: supabaseAdmin(),
      accountId,
      agentUserId: assignedAgentUserId,
      propertyId: enquiryPropertyId,
      contactId: contactRecord.id,
      leadName: contactRecord.name || senderPhone,
      leadPhone: senderPhone,
      enquiryText: preview,
    });

    await createNotification({
      accountId,
      userId: assignedAgentUserId,
      type: 'new_message',
      eventKey: 'property_enquiry',
      title: `Enquiry: ${contactRecord.name || senderPhone}`,
      body: preview,
      entityType: 'conversation',
      entityId: conversation.id,
      link: `/inbox?conversation=${conversation.id}`,
      // The card is the WhatsApp ping. Only when it could not be
      // delivered does the plain text one stand in for it — and the
      // channel has to be forced off, not merely left without a text:
      // createNotification falls back to title+body on WhatsApp, which
      // put a second "Enquiry: …" bubble under the card on the very
      // first live run.
      ...(cardSent
        ? { channels: { inApp: true, push: true, whatsapp: false } }
        : {
            whatsappText: [
              '🔔 *New property enquiry*',
              `👤 ${contactRecord.name || senderPhone}`,
              '',
              preview,
              '',
              BRIDGE_REPLY_HINT,
            ].join('\n'),
          }),
    });

    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
      kind: 'text',
      senderType: 'bot',
      text:
        unavailableListingReply(
          contactRecord.name,
          enquiryPropertyTitle,
          enquiryPropertyStatus
        ) ??
        appendListingStatusNote(
          buildEnquiryAckText(contactRecord.name, enquiryPropertyTitle),
          enquiryPropertyStatus
        ),
    });
    return 'handled';
  }
  return 'continue';
}
