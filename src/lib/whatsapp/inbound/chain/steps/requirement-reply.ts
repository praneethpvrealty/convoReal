import { processRequirementReply } from '@/lib/requirements/respond';
import type { InboundChainContext, StepResult } from '../context';

export async function requirementReply(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    senderPhone,
    contentText,
    ownerCheck,
    contactRecord,
    conversation,
  } = ctx;
  // Co-broker requirement replies: a message quoting REQ-XXXX from a
  // shared requirement (backed by a live share link) reveals the brief
  // and opens an external listing intake session for it. Never for the
  // account owner, and a no-op for every other message.
  if (contentText && !ownerCheck.isOwner) {
    const handledRequirementReply = await processRequirementReply({
      accountId,
      contentText,
      senderPhone,
      contactRecord: {
        id: contactRecord.id,
        classification: contactRecord.classification,
      },
      conversationId: conversation.id,
    });
    if (handledRequirementReply) return 'handled';
  }
  return 'continue';
}
