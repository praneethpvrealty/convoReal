import {
  MAX_INVENTORY_SELECTIONS,
  parseInventorySelectionCommand,
  resolveInventorySelectionReference,
} from '@/lib/whatsapp/inventory-selection';
import { createNotification } from '@/lib/notifications/create';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { handlePropertyShareYesReply } from '@/lib/whatsapp/inbound/property-share-replies';
import type { InboundChainContext, StepResult } from '../context';

export async function inventorySelection(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    configOwnerUserId,
    senderPhone,
    contentText,
    ownerCheck,
    contactRecord,
    conversation,
    assignedAgentUserId,
    isTextMessage,
  } = ctx;
  const inventorySelection = parseInventorySelectionCommand(contentText);
  if (!ownerCheck.isOwner && isTextMessage && inventorySelection) {
    const admin = supabaseAdmin();
    if (inventorySelection.ordinals.length > MAX_INVENTORY_SELECTIONS) {
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        toPhone: senderPhone,
        kind: 'text',
        senderType: 'bot',
        text: `Please choose up to ${MAX_INVENTORY_SELECTIONS} properties at a time — for example: ${inventorySelection.category.toLowerCase()} 3,9.`,
      });
      return 'handled';
    }

    const propertyIds = await resolveInventorySelectionReference(
      admin,
      accountId,
      conversation.id,
      inventorySelection
    );
    if (propertyIds.length !== inventorySelection.ordinals.length) {
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        toPhone: senderPhone,
        kind: 'text',
        senderType: 'bot',
        text: `I couldn't safely match those numbers to the latest ${inventorySelection.category} list. Reply “Send full list” first, then choose numbers shown under ${inventorySelection.category} — for example: ${inventorySelection.category.toLowerCase()} 3,9.`,
      });
      return 'handled';
    }

    const sentPropertyIds: string[] = [];
    for (const propertyId of propertyIds) {
      const sent = await handlePropertyShareYesReply(
        propertyId,
        accountId,
        configOwnerUserId,
        contactRecord.id,
        conversation.id,
        senderPhone,
        { followUp: 'none' }
      );
      if (sent) sentPropertyIds.push(propertyId);
    }

    const allSent = sentPropertyIds.length === propertyIds.length;
    const completionText = allSent
      ? sentPropertyIds.length === 1
        ? 'I’ve shared the complete property details and showcase link. Reply with any questions or tell me if you would like to visit.'
        : `I’ve shared complete details and individual showcase links for all ${sentPropertyIds.length} properties. Reply with any questions or tell me which one you would like to visit.`
      : sentPropertyIds.length > 0
        ? `I shared ${sentPropertyIds.length} of the ${propertyIds.length} requested properties. I’ve asked the team to send the remaining details here.`
        : 'I found those listings, but could not send their details automatically. I’ve asked the team to follow up here.';

    const completionTasks: PromiseLike<unknown>[] = [
      sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        toPhone: senderPhone,
        kind: 'text',
        senderType: 'bot',
        text: completionText,
      }),
      admin
        .from('conversations')
        .update({ status: 'pending', updated_at: new Date().toISOString() })
        .eq('id', conversation.id)
        .eq('account_id', accountId),
      createNotification({
        accountId,
        userId: assignedAgentUserId,
        type: 'listing_interest',
        title: `${contactRecord.name || senderPhone} selected ${inventorySelection.category} properties`,
        body: allSent
          ? `Complete details sent for ${inventorySelection.ordinals.join(', ')} from the latest ${inventorySelection.category} list.`
          : `Requested ${inventorySelection.ordinals.join(', ')} from the latest ${inventorySelection.category} list; ${propertyIds.length - sentPropertyIds.length} details send failed.`,
        entityType: 'conversation',
        entityId: conversation.id,
        link: `/inbox?conversation=${conversation.id}`,
      }),
      admin.from('contact_property_inquiries').upsert(
        propertyIds.map((propertyId) => ({
          account_id: accountId,
          contact_id: contactRecord.id,
          property_id: propertyId,
          inquiry_source: 'WhatsApp inventory selection',
          inquiry_date: new Date().toISOString(),
          notes: (contentText || '').slice(0, 500),
        })),
        { onConflict: 'contact_id,property_id' }
      ),
    ];
    await Promise.all(completionTasks);
    return 'handled';
  }
  return 'continue';
}
