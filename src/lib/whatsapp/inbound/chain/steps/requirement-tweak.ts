import {
  handleRequirementTweakReply,
  REQUIREMENT_TWEAK_ID_PREFIX,
} from '@/lib/whatsapp/requirement-review';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { InboundChainContext, StepResult } from '../context';

export async function requirementTweak(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    configOwnerUserId,
    interactiveReplyId,
    contactRecord,
    conversation,
  } = ctx;
  // A tap on the requirement playback card — confirm the brief, or
  // re-open the type/budget lists and the typed area question.
  if (interactiveReplyId?.startsWith(REQUIREMENT_TWEAK_ID_PREFIX)) {
    const handledTweak = await handleRequirementTweakReply({
      db: supabaseAdmin(),
      accountId,
      configOwnerUserId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
      replyId: interactiveReplyId,
    });
    if (handledTweak) return 'handled';
  }
  return 'continue';
}
