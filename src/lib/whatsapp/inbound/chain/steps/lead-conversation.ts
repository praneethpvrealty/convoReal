import { processExternalListingMessage } from '@/lib/ai/chatbot-engine';
import {
  processBuyerQualificationMessage,
  carriesRequirementSignal,
} from '@/lib/ai/buyer-qualification';
import {
  isPropertyDisinterest,
  handlePropertyDisinterestMessage,
} from '@/lib/whatsapp/property-disinterest';
import {
  captureTypedCheckBack,
  sendCheckBackConfirm,
  handleInboxCheckinReply,
} from '@/lib/journey/client-response';
import {
  looksLikeQuestion,
  offersOwnCall,
  requestsHumanContact,
} from '@/lib/ai/lead-question';
import {
  isInboundVisitRequest,
  tryHandleInboundScheduling,
} from '@/lib/calendar/whatsapp-scheduler';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logText } from '@/lib/whatsapp/inbound/log-text';
import type { InboundChainContext, StepResult } from '../context';

export async function leadConversation(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    accessToken,
    message,
    configOwnerUserId,
    phoneNumberId,
    senderPhone,
    contentText,
    ownerCheck,
    contactRecord,
    conversation,
    assignedAgentUserId,
  } = ctx;
  if (!ownerCheck.isOwner) {
    const { data: externalListingSession } = await supabaseAdmin()
      .from('property_draft_sessions')
      .select('id')
      .eq('contact_id', contactRecord.id)
      .eq('session_mode', 'external')
      .maybeSingle();

    if (externalListingSession) {
      console.log(
        `[webhook] Intercepted message for active external listing session: ${logText(senderPhone)}`
      );
      const handled = await processExternalListingMessage(
        message,
        contentText,
        contactRecord,
        conversation,
        accountId,
        accessToken,
        phoneNumberId
      );
      if (handled) {
        return 'handled';
      }
    }

    // A lead asking to meet ("can we visit the JP Nagar flat Saturday 3pm?")
    // books the appointment on the agent's calendar. Runs before the
    // read-only calendar query below so a concrete date/time creates an
    // event instead of just listing existing ones; vague schedule talk
    // ("what visits do I have?") falls through untouched.
    // A question that happens to mention a day is not a booking request.
    // "Can we see inside when we visit tomorrow" parsed as a schedule and
    // re-acknowledged a visit already in the diary; it is a question about
    // access, and it belongs on the answer ladder below.
    // "Call me tomorrow at 5" carries a date and a time but asks for a
    // phone call, not a site visit — it belongs to the handover branch
    // below, the same way a question does.
    // "I'll call back tomorrow" is the lead's own call, not a visit to
    // book — it belongs to the check-in and timeline capture below,
    // unless the same message also asks to visit.
    if (
      !requestsHumanContact(contentText) &&
      (isInboundVisitRequest(contentText || '') ||
        (!offersOwnCall(contentText) && !looksLikeQuestion(contentText)))
    ) {
      const booked = await tryHandleInboundScheduling({
        message,
        contentText,
        contactRecord,
        conversation,
        accountId,
        ownerUserId: configOwnerUserId,
        assignedAgentUserId,
        accessToken,
        phoneNumberId,
      });
      if (booked) return 'handled';
    }

    // A text reply to a journey check-in the agent sent from the Engine
    // inbox ("just checking in on <property>..."). Logged on the journey
    // either way; the message is only consumed when the timeline ask
    // went out — a reply that reads as a question still falls through
    // so the bot answers it.
    if (message.type === 'text' && contentText) {
      const checkinOutcome = await handleInboxCheckinReply({
        db: supabaseAdmin(),
        accountId,
        ownerUserId: configOwnerUserId,
        contact: {
          id: contactRecord.id,
          name: contactRecord.name,
          phone: senderPhone,
        },
        conversationId: conversation.id,
        responseText: contentText,
        accessToken,
        phoneNumberId,
      });
      if (checkinOutcome === 'logged_and_asked') return 'handled';
    }

    // A lead rejecting a property ("not interested", "not for me", "don't like this").
    // If the message does not carry a new requirement brief, resolve the property,
    // record the rejection on listing_feedback, and send the interactive factor
    // prompt with one-tap options (type / budget / location / size / other) + typing invitation.
    if (
      !ownerCheck.isOwner &&
      message.type === 'text' &&
      contentText &&
      isPropertyDisinterest(contentText)
    ) {
      const hasRequirement = carriesRequirementSignal(contentText);
      if (!hasRequirement) {
        let quotedPropertyId: string | null = null;
        if (message.context?.id) {
          const { data: quotedMsg } = await supabaseAdmin()
            .from('messages')
            .select('property_id, content_text')
            .eq('message_id', message.context.id)
            .maybeSingle();
          if (quotedMsg?.property_id) {
            quotedPropertyId = quotedMsg.property_id;
          }
        }

        const handledDisinterest = await handlePropertyDisinterestMessage({
          db: supabaseAdmin(),
          accountId,
          configOwnerUserId,
          contact: contactRecord,
          conversationId: conversation.id,
          inboundText: contentText,
          quotedPropertyId,
        });
        if (handledDisinterest) return 'handled';
      }
    }

    // A client answering the journey timeline question in words rather
    // than by tapping — "By the 5th of September". It used to land
    // nowhere: no acknowledgement, no date, and a new listing pitched
    // seconds later. Runs before qualification, which no longer claims
    // this answer but has nothing to say about it either.
    if (message.type === 'text' && contentText) {
      try {
        const { data: previous } = await supabaseAdmin()
          .from('messages')
          .select('sender_type, content_text')
          .eq('conversation_id', conversation.id)
          .order('created_at', { ascending: false })
          .limit(4);
        const previousBot = (previous ?? [])
          .slice(1)
          .find((m) => m.sender_type !== 'customer');
        if (previousBot?.sender_type === 'bot') {
          const reply = await captureTypedCheckBack({
            db: supabaseAdmin(),
            accountId,
            ownerUserId: configOwnerUserId,
            contact: { id: contactRecord.id, name: contactRecord.name },
            text: contentText,
            previousBotText: previousBot.content_text as string | null,
          });
          if (reply) {
            await sendCheckBackConfirm({
              db: supabaseAdmin(),
              accountId,
              ownerUserId: configOwnerUserId,
              contactId: contactRecord.id,
              conversationId: conversation.id,
              reply,
            });
            return 'handled';
          }
        }
      } catch (err) {
        console.error('[timeline] typed check-back capture failed:', err);
      }
    }

    // A lead answering "what are your requirements and budget?" — the
    // question the lead-sync auto-reply ends with. Files the answer on
    // the contact and replies with the next missing qualifier or the
    // matching listings. No-op for accounts with auto_qualify_leads off,
    // for non-buyers, and for messages that carry no requirement.
    if (message.type === 'text') {
      const qualified = await processBuyerQualificationMessage(
        contentText,
        contactRecord,
        conversation,
        accountId,
        accessToken,
        phoneNumberId,
        configOwnerUserId,
        message.id
      );
      if (qualified) return 'handled';
    }
  }
  return 'continue';
}
