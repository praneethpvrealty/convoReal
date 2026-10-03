import { handlePropertyDisinterestMessage } from '@/lib/whatsapp/property-disinterest';
import { handleListingFeedbackReply } from '@/lib/whatsapp/listing-feedback';
import { findFeedbackSharePropertyId } from '@/lib/whatsapp/share-feedback';
import { matchTemplateButton } from '@/lib/whatsapp/template-copy';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { InboundChainContext, StepResult } from '../context';

export async function listingFeedbackTap(
  ctx: InboundChainContext
): Promise<StepResult> {
  const { accountId, message, configOwnerUserId, contactRecord, conversation } =
    ctx;
  const feedbackAction = matchTemplateButton(message.button?.text);
  if (feedbackAction === 'feedback_perfect') {
    const feedbackDb = supabaseAdmin();
    const sharedPropertyId = await findFeedbackSharePropertyId(
      feedbackDb,
      accountId,
      contactRecord.id,
      message.context?.id ?? null
    );
    if (
      sharedPropertyId &&
      (await handleListingFeedbackReply({
        db: feedbackDb,
        accountId,
        configOwnerUserId,
        contact: contactRecord,
        conversationId: conversation.id,
        replyId: `lfb_y_${sharedPropertyId}`,
      }))
    ) {
      return 'handled';
    }
    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
      kind: 'text',
      senderType: 'bot',
      text: "👍 Glad to hear that! We'll keep sharing similar properties with you.",
    });
    return 'handled';
  }
  if (feedbackAction === 'feedback_not_interested') {
    const handled = await handlePropertyDisinterestMessage({
      db: supabaseAdmin(),
      accountId,
      configOwnerUserId,
      contact: contactRecord,
      conversationId: conversation.id,
      inboundText: 'Not interested',
    });
    if (handled) return 'handled';
  }
  return 'continue';
}
