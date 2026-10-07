import { requestsHumanContact } from '@/lib/ai/lead-question';
import {
  appendListingStatusNote,
  listingStatusAgentLine,
  UNAVAILABLE_LISTING_AGENT_NOTE,
} from '@/lib/inventory/listing-status';
import { isInboundVisitRequest } from '@/lib/calendar/whatsapp-scheduler';
import { createNotification } from '@/lib/notifications/create';
import { BRIDGE_REPLY_HINT } from '@/lib/whatsapp/reply-bridge';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { unavailableListingReplyWithShowcase } from '@/lib/inventory/unavailable-reply';
import {
  buildPropertyInterestAck,
  buildUnresolvedPropertyInterestAck,
} from '@/lib/whatsapp/property-interest';
import { handlePropertyShareYesReply } from '@/lib/whatsapp/inbound/property-share-replies';
import type { InboundChainContext, StepResult } from '../context';

export async function specificPropertyInterest(
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
    specificPropertyInterest,
    propertyReferenceNeedsAgent,
    ownerCheck,
    contactRecord,
    conversation,
    assignedAgentUserId,
  } = ctx;
  // A buyer referring to one listing they already saw is not giving us
  // a new requirement. Resolve the locality + size (or Meta catalog
  // retailer id), acknowledge that exact property, send its complete
  // details immediately, and put the assigned agent on the thread. The
  // property-code showcase CTA keeps its approval-card flow below.
  if (
    !ownerCheck.isOwner &&
    specificPropertyInterest &&
    (message.type === 'order' || !enquiryIsDeliberate)
  ) {
    const admin = supabaseAdmin();

    if (enquiryPropertyId && enquiryPropertyTitle) {
      const visitRequested = isInboundVisitRequest(contentText || '');
      const ownerContactRequested = requestsHumanContact(contentText);
      const actionRequested = visitRequested || ownerContactRequested;
      const statusAgentLine = listingStatusAgentLine(enquiryPropertyStatus);
      const unavailableReply = await unavailableListingReplyWithShowcase({
        db: admin,
        accountId,
        contactId: contactRecord.id,
        contactName: contactRecord.name,
        propertyTitle: enquiryPropertyTitle,
        status: enquiryPropertyStatus,
      });
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        toPhone: senderPhone,
        kind: 'text',
        senderType: 'bot',
        text:
          unavailableReply ??
          appendListingStatusNote(
            buildPropertyInterestAck(
              contactRecord.name,
              enquiryPropertyTitle,
              statusAgentLine ? {} : { visitRequested, ownerContactRequested }
            ),
            enquiryPropertyStatus
          ),
      });

      const [shareSent] = await Promise.all([
        unavailableReply
          ? Promise.resolve(false)
          : handlePropertyShareYesReply(
              enquiryPropertyId,
              accountId,
              configOwnerUserId,
              contactRecord.id,
              conversation.id,
              senderPhone,
              { followUp: actionRequested ? 'none' : 'questions' }
            ),
        admin.from('contact_property_inquiries').upsert(
          {
            account_id: accountId,
            contact_id: contactRecord.id,
            property_id: enquiryPropertyId,
            inquiry_source:
              message.type === 'order' ? 'WhatsApp Catalog' : 'WhatsApp',
            inquiry_date: new Date().toISOString(),
            notes: (contentText || '').slice(0, 500),
          },
          { onConflict: 'contact_id,property_id' }
        ),
        admin.from('listing_feedback').upsert(
          {
            account_id: accountId,
            contact_id: contactRecord.id,
            property_id: enquiryPropertyId,
            verdict: 'interested',
            reason: null,
          },
          { onConflict: 'contact_id,property_id' }
        ),
      ]);

      await admin
        .from('conversations')
        .update({ status: 'pending', updated_at: new Date().toISOString() })
        .eq('id', conversation.id)
        .eq('account_id', accountId);

      await createNotification({
        accountId,
        userId: assignedAgentUserId,
        type: 'listing_interest',
        title: actionRequested
          ? `${contactRecord.name || senderPhone} needs follow-up for ${enquiryPropertyTitle}`
          : `${contactRecord.name || senderPhone} wants ${enquiryPropertyTitle}`,
        body: [
          statusAgentLine,
          unavailableReply
            ? UNAVAILABLE_LISTING_AGENT_NOTE
            : shareSent
              ? actionRequested
                ? [
                    visitRequested ? 'Site visit requested.' : '',
                    ownerContactRequested
                      ? 'Owner conversation requested.'
                      : '',
                    'The exact property details were sent; please coordinate the requested next step.',
                  ]
                    .filter(Boolean)
                    .join(' ')
                : 'The exact property details were sent. Reply to answer any property-specific questions.'
              : 'The listing was matched, but the automatic details send failed. Please share it and follow up now.',
        ]
          .filter(Boolean)
          .join(' '),
        entityType: 'conversation',
        entityId: conversation.id,
        link: `/inbox?conversation=${conversation.id}`,
        whatsappText: [
          actionRequested
            ? '📅 *Property follow-up requested*'
            : '🔥 *Specific property interest*',
          `👤 ${contactRecord.name || senderPhone}`,
          `🏠 ${enquiryPropertyTitle}`,
          ...(statusAgentLine ? [statusAgentLine] : []),
          '',
          (contentText || '').slice(0, 300),
          '',
          unavailableReply
            ? UNAVAILABLE_LISTING_AGENT_NOTE
            : shareSent
              ? actionRequested
                ? 'The listing details have already been sent. Please coordinate the visit / owner conversation now.'
                : 'The listing details have already been sent.'
              : '⚠️ The automatic details send failed — please share them now.',
          BRIDGE_REPLY_HINT,
        ].join('\n'),
      });
      return 'handled';
    }

    if (propertyReferenceNeedsAgent) {
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        toPhone: senderPhone,
        kind: 'text',
        senderType: 'bot',
        text: buildUnresolvedPropertyInterestAck(contactRecord.name),
      });
      await admin
        .from('conversations')
        .update({ status: 'pending', updated_at: new Date().toISOString() })
        .eq('id', conversation.id)
        .eq('account_id', accountId);
      await createNotification({
        accountId,
        userId: assignedAgentUserId,
        type: 'listing_interest',
        title: `Property reference needs matching: ${contactRecord.name || senderPhone}`,
        body: (contentText || '').slice(0, 300),
        entityType: 'conversation',
        entityId: conversation.id,
        link: `/inbox?conversation=${conversation.id}`,
        whatsappText: [
          '⚠️ *Property reference needs matching*',
          `👤 ${contactRecord.name || senderPhone}`,
          '',
          (contentText || '').slice(0, 300),
          '',
          'ConvoReal did not guess. Please confirm the listing and share its details.',
          BRIDGE_REPLY_HINT,
        ].join('\n'),
      });
      return 'handled';
    }
  }
  return 'continue';
}
