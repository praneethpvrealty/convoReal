import {
  CHECKBACK_CONFIRM_PREFIX,
  CLIENT_FOLLOWUP_PREFIX,
  handleCheckBackConfirmReply,
  handleClientFollowupReply,
} from '@/lib/journey/client-response';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  SOLD_PRICE_BUTTON_PREFIX,
  SOLD_SIMILAR_BUTTON_PREFIX,
} from '@/lib/whatsapp/sold-notification';
import {
  handleBrowseAllProperties,
  handlePropertyShareNoReply,
  handlePropertyShareYesReply,
  handleShowMoreProperties,
  handleSoldPriceReply,
} from '@/lib/whatsapp/inbound/property-share-replies';
import type { InboundChainContext, StepResult } from '../context';

export async function interactiveReplyDispatch(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    configOwnerUserId,
    senderPhone,
    interactiveReplyId,
    contactRecord,
    conversation,
  } = ctx;
  if (interactiveReplyId) {
    if (interactiveReplyId.startsWith(CHECKBACK_CONFIRM_PREFIX)) {
      const handledConfirm = await handleCheckBackConfirmReply({
        db: supabaseAdmin(),
        accountId,
        ownerUserId: configOwnerUserId,
        contact: {
          id: contactRecord.id,
          name: contactRecord.name,
          phone: senderPhone,
        },
        conversationId: conversation.id,
        replyId: interactiveReplyId,
      });
      if (handledConfirm) return 'handled';
    }
    if (interactiveReplyId.startsWith(CLIENT_FOLLOWUP_PREFIX)) {
      const handledFollowup = await handleClientFollowupReply({
        db: supabaseAdmin(),
        accountId,
        ownerUserId: configOwnerUserId,
        contact: {
          id: contactRecord.id,
          name: contactRecord.name,
          phone: senderPhone,
        },
        conversationId: conversation.id,
        replyId: interactiveReplyId,
      });
      if (handledFollowup) return 'handled';
    }
    // Consent and owner decisions are dispatched far earlier, before
    // the reply bridge and the owner chatbot can interpret them.
    if (interactiveReplyId.startsWith('share_property_yes:')) {
      const propertyId = interactiveReplyId.split(':')[1];
      await handlePropertyShareYesReply(
        propertyId,
        accountId,
        configOwnerUserId,
        contactRecord.id,
        conversation.id,
        senderPhone
      );
      return 'handled';
    } else if (interactiveReplyId.startsWith('share_property_no:')) {
      const propertyId = interactiveReplyId.split(':')[1];
      await handlePropertyShareNoReply(
        propertyId,
        accountId,
        configOwnerUserId,
        contactRecord.id,
        conversation.id,
        senderPhone
      );
      return 'handled';
    } else if (interactiveReplyId.startsWith('show_more_properties:')) {
      const propertyId = interactiveReplyId.split(':')[1];
      await handleShowMoreProperties(
        propertyId,
        accountId,
        configOwnerUserId,
        contactRecord.id,
        conversation.id,
        senderPhone
      );
      return 'handled';
    } else if (interactiveReplyId === 'browse_all_properties') {
      await handleBrowseAllProperties(
        accountId,
        configOwnerUserId,
        contactRecord.id,
        conversation.id,
        senderPhone
      );
      return 'handled';
    } else if (interactiveReplyId.startsWith(SOLD_PRICE_BUTTON_PREFIX)) {
      const propertyId = interactiveReplyId.slice(
        SOLD_PRICE_BUTTON_PREFIX.length
      );
      await handleSoldPriceReply(
        propertyId,
        accountId,
        configOwnerUserId,
        contactRecord.id,
        conversation.id,
        senderPhone
      );
      return 'handled';
    } else if (interactiveReplyId.startsWith(SOLD_SIMILAR_BUTTON_PREFIX)) {
      const propertyId = interactiveReplyId.slice(
        SOLD_SIMILAR_BUTTON_PREFIX.length
      );
      await handleShowMoreProperties(
        propertyId,
        accountId,
        configOwnerUserId,
        contactRecord.id,
        conversation.id,
        senderPhone
      );
      return 'handled';
    }
  }
  return 'continue';
}
