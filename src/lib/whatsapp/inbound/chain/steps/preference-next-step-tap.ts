import {
  handlePreferenceNextStepReply,
  PREFERENCE_NEXT_STEP_ID_PREFIX,
} from '@/lib/whatsapp/preference-next-steps';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { InboundChainContext, StepResult } from '../context';

export async function preferenceNextStepTap(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    configOwnerUserId,
    senderPhone,
    interactiveReplyId,
    contactRecord,
    conversation,
  } = ctx;
  // A tap on the next-steps menu that follows a no-match preference
  // reply: the nearest fits from elsewhere in the city, or a call back.
  // Its other rows (budget, area, type, the form) carry the ids of the
  // handlers that already own them.
  if (interactiveReplyId?.startsWith(PREFERENCE_NEXT_STEP_ID_PREFIX)) {
    const handled = await handlePreferenceNextStepReply({
      db: supabaseAdmin(),
      accountId,
      configOwnerUserId,
      contact: {
        id: contactRecord.id,
        name: contactRecord.name,
        phone: senderPhone,
      },
      conversationId: conversation.id,
      replyId: interactiveReplyId,
    });
    if (handled) return 'handled';
  }
  return 'continue';
}
