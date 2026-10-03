import {
  ENQUIRY_DROPOFF_ID_PREFIX,
  handleEnquiryDropoffReason,
} from '@/lib/whatsapp/enquiry-dropoff';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { InboundChainContext, StepResult } from '../context';

export async function enquiryDropoffReason(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    configOwnerUserId,
    interactiveReplyId,
    contactRecord,
    conversation,
  } = ctx;
  // The reason a closing lead gave for dropping a shared property. A
  // button the Engine minted, dispatched here for the same reason as the
  // control payloads above: an update session still collecting for this
  // contact, or any natural-language consumer further down, would read
  // "Budget too high" as its own answer. The contact is dead by now, so
  // the thank-you goes out on the dispatcher's opt-out.
  if (interactiveReplyId?.startsWith(ENQUIRY_DROPOFF_ID_PREFIX)) {
    const handledDropoff = await handleEnquiryDropoffReason({
      db: supabaseAdmin(),
      accountId,
      configOwnerUserId,
      contact: contactRecord,
      conversationId: conversation.id,
      replyId: interactiveReplyId,
    });
    if (handledDropoff) return 'handled';
  }
  return 'continue';
}
