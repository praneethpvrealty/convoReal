import { matchTemplateButton } from '@/lib/whatsapp/template-copy';
import { handleUpdateNoticeReply } from '@/lib/deals/update-delivery';
import { handlePurchaseProgressReply } from '@/lib/journey/closing-nudges';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { InboundChainContext, StepResult } from '../context';

export async function purchaseProgressTap(
  ctx: InboundChainContext
): Promise<StepResult> {
  const { accountId, message, configOwnerUserId, contactRecord, conversation } =
    ctx;
  // Ahead of the enquiry buttons below: these come from a buyer who is
  // mid-purchase, and the enquiry handlers would file their answer as a
  // decision about an open enquiry.
  const progressAction = matchTemplateButton(message.button?.text);
  if (
    progressAction === 'paperwork_on_track' ||
    progressAction === 'paperwork_pending'
  ) {
    // A tap on a notice that carried a Transaction Workspace update:
    // the private link the template could not carry goes now, and the
    // tap is the acknowledgement. Ahead of the closing-nudge handler,
    // which would file the same tap as a journey stall answer.
    const handledNotice = await handleUpdateNoticeReply({
      db: supabaseAdmin(),
      accountId,
      ownerUserId: configOwnerUserId,
      contact: { id: contactRecord.id, name: contactRecord.name },
      conversationId: conversation.id,
      contextMessageId: message.context?.id ?? null,
      onTrack: progressAction === 'paperwork_on_track',
    });
    if (handledNotice) return 'handled';
    const handledProgress = await handlePurchaseProgressReply({
      accountId,
      ownerUserId: configOwnerUserId,
      contact: { id: contactRecord.id, name: contactRecord.name },
      conversationId: conversation.id,
      onTrack: progressAction === 'paperwork_on_track',
    });
    if (handledProgress) return 'handled';
  }
  return 'continue';
}
