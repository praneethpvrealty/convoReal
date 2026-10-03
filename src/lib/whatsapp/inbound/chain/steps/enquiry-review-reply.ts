import {
  ENQUIRY_REVIEW_ID_PREFIX,
  handleEnquiryReviewReply,
} from '@/lib/whatsapp/enquiry-review';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { InboundChainContext, StepResult } from '../context';

export async function enquiryReviewReply(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    configOwnerUserId,
    interactiveReplyId,
    contactRecord,
    conversation,
  } = ctx;
  // The open-enquiry review that follows a close: one more listing
  // closed, or all of them kept. Same dispatch reason as the reason
  // list above.
  if (interactiveReplyId?.startsWith(ENQUIRY_REVIEW_ID_PREFIX)) {
    const handledReview = await handleEnquiryReviewReply({
      db: supabaseAdmin(),
      accountId,
      configOwnerUserId,
      contact: contactRecord,
      conversationId: conversation.id,
      replyId: interactiveReplyId,
    });
    if (handledReview) return 'handled';
  }
  return 'continue';
}
