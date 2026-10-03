import { JOURNEY_CHECKIN_KEEP_BUTTON } from '@/lib/whatsapp/journey-checkin-template';
import { handleInboxCheckinReply } from '@/lib/journey/client-response';
import { matchTemplateButton } from '@/lib/whatsapp/template-copy';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { InboundChainContext, StepResult } from '../context';

export async function stillConsideringTap(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    accessToken,
    message,
    configOwnerUserId,
    phoneNumberId,
    senderPhone,
    contactRecord,
    conversation,
  } = ctx;
  if (matchTemplateButton(message.button?.text) === 'still_considering') {
    const keepOutcome = await handleInboxCheckinReply({
      db: supabaseAdmin(),
      accountId,
      ownerUserId: configOwnerUserId,
      contact: {
        id: contactRecord.id,
        name: contactRecord.name,
        phone: senderPhone,
      },
      conversationId: conversation.id,
      responseText: JOURNEY_CHECKIN_KEEP_BUTTON,
      accessToken,
      phoneNumberId,
      fromButton: true,
    });
    if (keepOutcome !== 'logged_and_asked') {
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        kind: 'text',
        senderType: 'bot',
        text: "👍 Great — noted! We'll keep you posted.",
      });
    }
    return 'handled';
  }
  return 'continue';
}
