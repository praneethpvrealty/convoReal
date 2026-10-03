import { handleBridgedAgentReply } from '@/lib/whatsapp/reply-bridge';
import type { InboundChainContext, StepResult } from '../context';

export async function bridgedAgentReply(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    message,
    senderPhone,
    contentText,
    contactRecord,
    conversation,
    isControlReply,
  } = ctx;

  const bridged = isControlReply
    ? false
    : await handleBridgedAgentReply({
        message,
        contentText,
        accountId,
        senderPhone,
        agentContactId: contactRecord.id,
        agentConversationId: conversation.id,
      });
  if (bridged) return 'handled';
  return 'continue';
}
