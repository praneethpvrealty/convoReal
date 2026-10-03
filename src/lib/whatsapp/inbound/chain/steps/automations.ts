import { runAutomationsForTrigger } from '@/lib/automations/engine';
import type { InboundChainContext, StepResult } from '../context';

export async function automations(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    contactWasCreated,
    contactRecord,
    conversation,
    isFirstInboundMessage,
    inboundText,
    flowConsumed,
  } = ctx;

  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
  )[] = [];
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match');
  }
  if (contactWasCreated) automationTriggers.unshift('new_contact_created');
  if (isFirstInboundMessage)
    automationTriggers.unshift('first_inbound_message');
  for (const triggerType of automationTriggers) {
    try {
      await runAutomationsForTrigger({
        accountId,
        triggerType,
        contactId: contactRecord.id,
        context: {
          message_text: inboundText,
          conversation_id: conversation.id,
        },
      });
    } catch (err) {
      console.error('[automations] dispatch failed:', err);
    }
  }
  return 'continue';
}
