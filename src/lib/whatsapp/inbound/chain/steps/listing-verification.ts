import { processListingVerification } from '@/lib/showcase/listing-verification';
import type { InboundChainContext, StepResult } from '../context';

export async function listingVerification(
  ctx: InboundChainContext
): Promise<StepResult> {
  const { accountId, senderPhone, contentText, contactRecord, conversation } =
    ctx;
  // Seller listing funnel: a message carrying a web-submission code is
  // the reverse-verification step — process it and stop (don't fall
  // through to the owner/external chatbot flows). No-op for every other
  // message, so existing behavior is unchanged when there's no code.
  if (contentText) {
    const handledListingVerification = await processListingVerification({
      accountId,
      contentText,
      senderPhone,
      contactRecord: {
        id: contactRecord.id,
        classification: contactRecord.classification,
      },
      conversationId: conversation.id,
    });
    if (handledListingVerification) return 'handled';
  }
  return 'continue';
}
