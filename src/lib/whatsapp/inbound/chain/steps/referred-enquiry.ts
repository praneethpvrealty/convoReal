import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { parseEnquiryRef } from '@/lib/showcase/enquiry-ref';
import {
  buildGuestHoldAck,
  hideWhatsAppGuest,
  lastGuestEnquiry,
  openReferredEnquiry,
  resolveWhatsAppTapReferrer,
  revealWhatsAppGuest,
  type ShowcaseReferrer,
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
  const thread = {
    accountId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
  };
  const isEnquiry =
    message.type === 'text' &&
    Boolean(enquiryPropertyId) &&
    enquiryIsDeliberate;

  // Someone the listing side has no lead for: a sender it has never
  // heard from, or a contact this flow has already hidden. If their
  // number has an enquiry on record as an agent's guest, they are
  // still that agent's guest, however they write in. While the agent
  // has not answered, and after a decline or a timeout, whatever they
  // send stays in their thread, nothing answers it and nobody is
  // pinged. Only an enquiry on a listing is recorded: it joins the one
  // still waiting, so an approval files every listing they asked
  // about, and after a decline it goes back to the agent unless that
  // decline is less than a day old.
  const hidden =
    !contactWasCreated &&
    Boolean((contactRecord as { chain_only?: boolean }).chain_only);
  if (!contactWasCreated && !hidden) return 'continue';
  const last = await lastGuestEnquiry(admin, {
    accountId,
    contactId: contactRecord.id,
    senderPhone,
  });
  if (last?.status === 'approved') return 'continue';
  if (last && (!isEnquiry || !last.referrer)) {
    await hideWhatsAppGuest(admin, thread);
    return 'handled';
  }

  let referrer: ShowcaseReferrer;
  let sessionKey: string | null;
  if (last?.referrer) {
    referrer = last.referrer;
    sessionKey = last.sessionKey;
  } else {
    // The showcase's WhatsApp button, tapped by someone the account
    // has no lead for. When the message carries the reference of a
    // forwarded-link guest's session, the enquiry belongs to whoever
    // forwarded the link before it belongs to the listing side.
    if (!isEnquiry || !enquiryPropertyId) return 'continue';
    const found = await resolveWhatsAppTapReferrer(admin, {
      accountId,
      propertyId: enquiryPropertyId,
      senderPhone,
      enquiryRef: parseEnquiryRef(contentText),
    });
    if (!found) return 'continue';
    if (!found.isAgent) {
      await admin
        .from('contacts')
        .update({
          referrer_contact_id: found.contactId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', contactRecord.id)
        .eq('account_id', accountId);
      return 'continue';
    }
    referrer = found;
    sessionKey = found.sessionKey;
  }

  const outcome = await openReferredEnquiry(admin, {
    accountId,
    referrer,
    source: 'whatsapp',
    propertyId: enquiryPropertyId,
    requesterName: contactRecord.name || senderPhone,
    requesterPhone: senderPhone,
    sessionKey,
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
    await hideWhatsAppGuest(admin, thread);
    return 'handled';
  }

  await revealWhatsAppGuest(admin, {
    ...thread,
    referrerContactId: referrer.contactId,
  });
  return 'continue';
}
