import { handleReminderButtonReply } from '@/lib/whatsapp/inbound/reminder-reply';
import type { InboundChainContext, StepResult } from '../context';

export async function reminderButton(
  ctx: InboundChainContext
): Promise<StepResult> {
  const { accountId, message, configOwnerUserId, contactRecord, conversation } =
    ctx;
  if (message.type === 'button') {
    const consumed = await handleReminderButtonReply(
      message,
      accountId,
      contactRecord.id,
      conversation.id,
      configOwnerUserId
    );
    // A reminder tap is fully handled (stamp + ack + agent ping) —
    // don't let it fall through to digest parsing or the chatbots.
    if (consumed) return 'handled';
  }
  return 'continue';
}
