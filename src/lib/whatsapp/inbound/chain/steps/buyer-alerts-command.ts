import { sendAlertsOnboarding } from '@/lib/whatsapp/alerts-onboarding';
import {
  parseBuyerAlertsCommand,
  applyBuyerAlertsCommand,
} from '@/lib/buyer/alerts';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { InboundChainContext, StepResult } from '../context';

export async function buyerAlertsCommand(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    message,
    configOwnerUserId,
    contentText,
    contactRecord,
    conversation,
  } = ctx;
  const alertsCommand = parseBuyerAlertsCommand(
    message.button?.text ?? contentText
  );
  if (alertsCommand) {
    // START ALERTS also revives a lead a close marked dead, so the
    // confirmation and the ladder below clear the dispatcher's gate.
    const confirmation = await applyBuyerAlertsCommand({
      command: alertsCommand,
      accountId,
      contactId: contactRecord.id,
    });
    if (confirmation) {
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        kind: 'text',
        senderType: 'bot',
        text: confirmation,
      });
      // START ALERTS opened a free-form window at the lead's moment of
      // highest intent. Consent alone would waste it: run the first
      // missing rung of the tap ladder, or prove the saved profile
      // with matches when it is already complete.
      if (alertsCommand === 'start') {
        await sendAlertsOnboarding({
          db: supabaseAdmin(),
          accountId,
          userId: configOwnerUserId,
          contactId: contactRecord.id,
          conversationId: conversation.id,
        });
      }
      return 'handled';
    }
  }
  return 'continue';
}
