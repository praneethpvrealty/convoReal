import { handleViewNudgeReply } from '@/lib/showcase/view-nudge-reply';
import { VIEW_NUDGE_REPLY_PREFIX } from '@/lib/showcase/view-nudge-template';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { InboundChainContext, StepResult } from '../context';

export async function showcaseViewNudgeTap(
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
  if (interactiveReplyId?.startsWith(VIEW_NUDGE_REPLY_PREFIX)) {
    const handled = await handleViewNudgeReply({
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
