import { processOwnerChatbotMessage } from '@/lib/ai/chatbot-engine';
import { logText } from '@/lib/whatsapp/inbound/log-text';
import type { InboundChainContext, StepResult } from '../context';

export async function ownerChatbot(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    accessToken,
    message,
    configOwnerUserId,
    phoneNumberId,
    senderPhone,
    contentText,
    ownerCheck,
    contactRecord,
    conversation,
    waited,
  } = ctx;
  if (ownerCheck.isOwner) {
    console.log(
      `[webhook] Intercepted message from Engine owner: ${logText(senderPhone)}`
    );
    const handled = await processOwnerChatbotMessage(
      message,
      contentText,
      contactRecord,
      conversation,
      ownerCheck.accountId || accountId,
      ownerCheck.userId || configOwnerUserId,
      accessToken,
      phoneNumberId,
      { waited }
    );
    if (handled) {
      return 'handled';
    }
  }
  return 'continue';
}
