import {
  handleListingFeedbackReply,
  LISTING_FEEDBACK_ID_PREFIX,
} from '@/lib/whatsapp/listing-feedback';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { InboundChainContext, StepResult } from '../context';

export async function listingFeedbackList(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    configOwnerUserId,
    interactiveReplyId,
    contactRecord,
    conversation,
  } = ctx;
  // A tap on the listing-feedback list. Handled before the preference
  // trigger below: the list's "Update preferences" row title would
  // otherwise match the free-text preference regex and re-run the
  // listings reply instead of sending the form the row promises.
  if (interactiveReplyId?.startsWith(LISTING_FEEDBACK_ID_PREFIX)) {
    const handledFeedback = await handleListingFeedbackReply({
      db: supabaseAdmin(),
      accountId,
      configOwnerUserId,
      contact: contactRecord,
      conversationId: conversation.id,
      replyId: interactiveReplyId,
    });
    if (handledFeedback) return 'handled';
  }
  return 'continue';
}
