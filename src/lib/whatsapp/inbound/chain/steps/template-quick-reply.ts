import {
  parseTemplateQuickReply,
  lastSharedPropertyId,
  buildFullListMessage,
  DETAILS_FALLBACK_TEXT,
  SITE_VISIT_ACK_TEXT,
} from '@/lib/whatsapp/template-quick-replies';
import { createNotification } from '@/lib/notifications/create';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { handlePropertyShareYesReply } from '@/lib/whatsapp/inbound/property-share-replies';
import type { InboundChainContext, StepResult } from '../context';

export async function templateQuickReply(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    message,
    configOwnerUserId,
    senderPhone,
    contentText,
    contactRecord,
    conversation,
  } = ctx;
  // Quick replies on the Engine's own property and inventory templates.
  // The tap opens the 24-hour window, so every answer below is
  // free-form. Without these the buttons were dead ends: a lead who
  // tapped "Send more details" got silence.
  const templateQuickReply = parseTemplateQuickReply(
    message.button?.text ?? contentText
  );
  if (templateQuickReply) {
    const admin = supabaseAdmin();
    if (templateQuickReply === 'property_details') {
      const propertyId = await lastSharedPropertyId(
        admin,
        accountId,
        contactRecord.id
      );
      if (propertyId) {
        // Same photo + full-details message the interactive "Yes"
        // reply sends, so the lead sees one consistent answer.
        await handlePropertyShareYesReply(
          propertyId,
          accountId,
          configOwnerUserId,
          contactRecord.id,
          conversation.id,
          senderPhone
        );
        return 'handled';
      }
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        kind: 'text',
        senderType: 'bot',
        text: DETAILS_FALLBACK_TEXT,
      });
      return 'handled';
    }

    if (templateQuickReply === 'inventory_full_list') {
      const fullList = await buildFullListMessage(
        admin,
        accountId,
        contactRecord.id
      );
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        kind: 'text',
        senderType: 'bot',
        text: fullList ?? DETAILS_FALLBACK_TEXT,
      });
      return 'handled';
    }

    // site_visit — a scheduling request is a person's job, so the lead
    // gets an acknowledgement and the assigned agent gets pinged.
    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
      kind: 'text',
      senderType: 'bot',
      text: SITE_VISIT_ACK_TEXT,
    });
    await createNotification({
      accountId,
      userId:
        (conversation as { assigned_agent_id?: string | null })
          .assigned_agent_id || configOwnerUserId,
      type: 'new_message',
      title: `Site visit requested: ${contactRecord.name || senderPhone}`,
      body: 'Tapped "Book a site visit" on a WhatsApp template.',
      entityType: 'conversation',
      entityId: conversation.id,
      link: `/inbox?conversation=${conversation.id}`,
    });
    return 'handled';
  }
  return 'continue';
}
