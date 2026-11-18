import { buildEnquiryAckText } from '@/lib/whatsapp/enquiry-card';
import { alertAgentOfPropertyEnquiry } from '@/lib/whatsapp/enquiry-alert';
import { appendListingStatusNote } from '@/lib/inventory/listing-status';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { unavailableListingReplyWithShowcase } from '@/lib/inventory/unavailable-reply';
import { sendRequirementConfirmAfterRegret } from '@/lib/whatsapp/unavailable-brief-followup';
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
    enquiryPropertyListingType,
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
    await alertAgentOfPropertyEnquiry({
      db: supabaseAdmin(),
      accountId,
      agentUserId: assignedAgentUserId,
      propertyId: enquiryPropertyId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
      leadName: contactRecord.name || senderPhone,
      leadPhone: senderPhone,
      enquiryText: (contentText || '').slice(0, 140),
    });

    const unavailableReply = await unavailableListingReplyWithShowcase({
      db: supabaseAdmin(),
      accountId,
      contactId: contactRecord.id,
      contactName: contactRecord.name,
      propertyTitle: enquiryPropertyTitle,
      status: enquiryPropertyStatus,
      listingType: enquiryPropertyListingType,
    });
    const ack = await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
      kind: 'text',
      senderType: 'bot',
      text:
        unavailableReply ??
        appendListingStatusNote(
          buildEnquiryAckText(contactRecord.name, enquiryPropertyTitle),
          enquiryPropertyStatus,
          enquiryPropertyListingType
        ),
    });
    if (unavailableReply && ack.success) {
      await sendRequirementConfirmAfterRegret({
        db: supabaseAdmin(),
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
      });
    }
    return 'handled';
  }
  return 'continue';
}
