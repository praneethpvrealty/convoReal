import { handleAgentInventoryDetailsRequest } from '@/lib/agents/inventory-reply';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { InboundChainContext, StepResult } from '../context';

export async function agentInventoryRequest(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    message,
    configOwnerUserId,
    contactRecord,
    conversation,
    inboundText,
    flowConsumed,
  } = ctx;
  if (!flowConsumed && (message.type === 'text' || message.type === 'button')) {
    const agentInventoryHandled = await handleAgentInventoryDetailsRequest({
      db: supabaseAdmin(),
      accountId,
      userId: configOwnerUserId,
      contactId: contactRecord.id,
      contactName: contactRecord.name || null,
      conversationId: conversation.id,
      text: message.button?.text ?? inboundText,
    });
    if (agentInventoryHandled) return 'handled';
  }
  return 'continue';
}
