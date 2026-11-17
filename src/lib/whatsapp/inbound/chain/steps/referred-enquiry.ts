import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import {
  buildGuestHoldAck,
  hasPendingReferredEnquiry,
  hideWhatsAppGuest,
  openReferredEnquiry,
  quietGuestThread,
  resolveWhatsAppTapReferrer,
} from '@/lib/showcase/referred-enquiries';
import type { InboundChainContext, StepResult } from '../context';

export async function referredEnquiry(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    message,
    senderPhone,
    contentText,
    enquiryPropertyId,
    enquiryIsDeliberate,
    enquiryPropertyTitle,
    ownerCheck,
    contactRecord,
    conversation,
    contactWasCreated,
    assignedAgentUserId,
  } = ctx;
  if (ownerCheck.isOwner) return 'continue';
  const admin = supabaseAdmin();

  // A guest whose enquiry is still waiting on the agent who forwarded
  // them the link. Whatever they send next stays in their thread, but
  // nothing answers it and nobody is pinged about it: they are not the
  // listing side's lead until that agent says so.
  if (!contactWasCreated) {
    if (!(contactRecord as { chain_only?: boolean }).chain_only) {
      return 'continue';
    }
    if (!(await hasPendingReferredEnquiry(admin, accountId, contactRecord.id)))
      return 'continue';
    await quietGuestThread(admin, {
      accountId,
      conversationId: conversation.id,
    });
    return 'handled';
  }

  // The showcase's WhatsApp button, tapped by someone the account has
  // never heard from. When the tap came from a forwarded-link guest,
  // the enquiry belongs to whoever forwarded the link before it
  // belongs to the listing side.
  if (!enquiryPropertyId || !enquiryIsDeliberate || message.type !== 'text') {
    return 'continue';
  }
  const referrer = await resolveWhatsAppTapReferrer(admin, {
    accountId,
    propertyId: enquiryPropertyId,
    senderPhone,
  });
  if (!referrer) return 'continue';

  const creditReferrer = () =>
    admin
      .from('contacts')
      .update({
        referrer_contact_id: referrer.contactId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactRecord.id)
      .eq('account_id', accountId);

  if (!referrer.isAgent) {
    await creditReferrer();
    return 'continue';
  }

  const outcome = await openReferredEnquiry(admin, {
    accountId,
    referrer,
    source: 'whatsapp',
    propertyId: enquiryPropertyId,
    requesterName: contactRecord.name || senderPhone,
    requesterPhone: senderPhone,
    sessionKey: referrer.sessionKey,
    payload: {
      targetAgentUserId: assignedAgentUserId,
      propertyTitle: enquiryPropertyTitle,
      enquiryText: (contentText || '').slice(0, 500),
    },
    contactId: contactRecord.id,
    conversationId: conversation.id,
  });
  if (outcome !== 'undeliverable') {
    if (outcome === 'pending') {
      await sendWhatsAppMessageAndPersist({
        accountId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        kind: 'text',
        senderType: 'bot',
        text: buildGuestHoldAck(
          contactRecord.name,
          enquiryPropertyTitle || 'that property'
        ),
        allowChainOnly: true,
      });
    }
    await hideWhatsAppGuest(admin, {
      accountId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
    });
    return 'handled';
  }

  await creditReferrer();
  return 'continue';
}
