import { parseEnquiryReply } from '@/lib/whatsapp/enquiry-card';
import {
  handleFollowUpReply,
  parseFollowUpReply,
} from '@/lib/contacts/follow-up-nudges';
import {
  handleClosingReply,
  parseClosingReply,
} from '@/lib/journey/closing-nudges';
import {
  CONSENT_APPROVE_PREFIX,
  CONSENT_DECLINE_PREFIX,
  OWNER_APPROVE_PREFIX,
  OWNER_REJECT_PREFIX,
  handleLocationConsentReply,
  handleOwnerLocationReply,
} from '@/lib/inventory/location-requests';
import {
  DOCUMENT_APPROVE_PREFIX,
  DOCUMENT_REJECT_PREFIX,
  handleDocumentDecisionReply,
} from '@/lib/inventory/document-requests';
import { UPDATE_CHANNEL_REPLY_PREFIX } from '@/lib/voice/announcements';
import { handleUpdateChannelReply } from '@/lib/voice/update-channel-reply';
import {
  POST_CALL_OPEN_PREFIX,
  handlePostCallOpenReply,
} from '@/lib/outreach/dispatcher';
import {
  AGENT_MESSAGE_CONTACT_PREFIX,
  handleAgentMessageContactReply,
} from '@/lib/calendar/agent-reminder-actions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { handleEnquiryCardReply } from '@/lib/whatsapp/inbound/enquiry-card-reply';
import type { InboundChainContext, StepResult } from '../context';

export async function controlReply(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    configOwnerUserId,
    senderPhone,
    interactiveReplyId,
    contactRecord,
    conversation,
    isControlReply,
  } = ctx;
  // A staff member quote-replying one of our agent pings is answering
  // the lead that ping was about — send it on and stop, so the text
  // never also lands in the owner chatbot or the digest commands.
  // No-op for every message that isn't a reply to a bridge message.
  //
  // EXCEPT a button we put there ourselves. Tapping Approve on an
  // owner-queue ping arrives as a reply carrying that ping's
  // context.id, so the bridge matched it and relayed "✅ Approve" to
  // the lead-reply reader, which answered the owner with "couldn't
  // match the client to a contact in your book" — and the approval
  // never ran, because its handler sits further down this function.
  // A control payload is an instruction to the Engine, not a reply to
  // a lead, so the bridge has to stand down for it.

  // Run the control payload HERE, before any natural-language path can
  // claim it. Two of them sit between this point and the dispatch that
  // used to run these: the reply bridge just below, and the owner
  // chatbot further down. The owner chatbot is the one that fired, in
  // production, twice — the ping goes to the account holder, so the tap
  // comes FROM the owner, whose messages it intercepts by design. It
  // read "✅ Approve" as a forwarded client conversation, answered
  // "couldn't match the client to a contact in your book", and returned
  // handled, while the approval sat 460 lines below, unreached.
  //
  // A button the Engine minted is unambiguous: it is an instruction,
  // and no amount of intent parsing can improve on knowing that. So it
  // is dispatched before anything gets a chance to interpret it.
  if (isControlReply && interactiveReplyId) {
    if (
      interactiveReplyId.startsWith(CONSENT_APPROVE_PREFIX) ||
      interactiveReplyId.startsWith(CONSENT_DECLINE_PREFIX)
    ) {
      const handled = await handleLocationConsentReply({
        admin: supabaseAdmin(),
        accountId,
        replyId: interactiveReplyId,
        senderPhone,
      });
      if (handled) return 'handled';
    }
    if (
      interactiveReplyId.startsWith(OWNER_APPROVE_PREFIX) ||
      interactiveReplyId.startsWith(OWNER_REJECT_PREFIX)
    ) {
      const handled = await handleOwnerLocationReply({
        admin: supabaseAdmin(),
        accountId,
        replyId: interactiveReplyId,
        senderPhone,
      });
      if (handled) return 'handled';
    }
    if (
      interactiveReplyId.startsWith(DOCUMENT_APPROVE_PREFIX) ||
      interactiveReplyId.startsWith(DOCUMENT_REJECT_PREFIX)
    ) {
      const handled = await handleDocumentDecisionReply({
        admin: supabaseAdmin(),
        accountId,
        replyId: interactiveReplyId,
        senderPhone,
      });
      if (handled) return 'handled';
    }
    if (interactiveReplyId.startsWith(UPDATE_CHANNEL_REPLY_PREFIX)) {
      const handled = await handleUpdateChannelReply({
        admin: supabaseAdmin(),
        accountId,
        replyId: interactiveReplyId,
        senderPhone,
      });
      if (handled) return 'handled';
    }
    // The post-call opener's quick reply — the lead asking for the
    // matched-listing follow-up. Their own tap just opened the window,
    // so the rich half goes out free-form.
    if (interactiveReplyId.startsWith(POST_CALL_OPEN_PREFIX)) {
      const handled = await handlePostCallOpenReply({
        admin: supabaseAdmin(),
        accountId,
        replyId: interactiveReplyId,
        senderPhone,
      });
      if (handled) return 'handled';
    }
    if (interactiveReplyId.startsWith(AGENT_MESSAGE_CONTACT_PREFIX)) {
      const handled = await handleAgentMessageContactReply({
        admin: supabaseAdmin(),
        accountId,
        ownerUserId: configOwnerUserId,
        agentContactId: contactRecord.id,
        agentConversationId: conversation.id,
        replyId: interactiveReplyId,
        senderPhone,
      });
      if (handled) return 'handled';
    }
    // A tap on the enquiry card. It arrives in the AGENT's thread but
    // every action operates on the BUYER's, which is why both ids ride
    // in the button — see enquiry-card.ts.
    const enquiryAction = parseEnquiryReply(interactiveReplyId);
    if (enquiryAction) {
      const handled = await handleEnquiryCardReply(
        enquiryAction,
        accountId,
        configOwnerUserId,
        { contactId: contactRecord.id, conversationId: conversation.id }
      );
      if (handled) return 'handled';
    }
    // A tap on the follow-up radar card — same shape as the enquiry
    // card: delivered to the agent, acting on the lead.
    const followUpAction = parseFollowUpReply(interactiveReplyId);
    if (followUpAction) {
      const handled = await handleFollowUpReply(
        followUpAction,
        accountId,
        configOwnerUserId,
        { contactId: contactRecord.id, conversationId: conversation.id }
      );
      if (handled) return 'handled';
    }
    // A tap on the closing card — the radar's sibling for deals already
    // at legal, acting on the journey item rather than the contact.
    const closingAction = parseClosingReply(interactiveReplyId);
    if (closingAction) {
      const handled = await handleClosingReply(
        closingAction,
        accountId,
        configOwnerUserId,
        { contactId: contactRecord.id, conversationId: conversation.id }
      );
      if (handled) return 'handled';
    }
  }
  return 'continue';
}
