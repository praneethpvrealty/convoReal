import {
  parseOwnerDigestCommand,
  applyOwnerDigestCommand,
} from '@/lib/owners/owner-digest';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import type { InboundChainContext, StepResult } from '../context';

export async function ownerDigestCommand(
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
  // Owner digest subscription control — "STOP UPDATES" / "START UPDATES"
  // free text, or the digest template's "Pause updates" quick-reply
  // button (which arrives as message.button.text). The chat itself is
  // the owner's control panel: no login needed, works anytime.
  const digestCommand = parseOwnerDigestCommand(
    message.button?.text ?? contentText
  );
  if (digestCommand) {
    const confirmation = await applyOwnerDigestCommand({
      command: digestCommand,
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
      return 'handled';
    }
  }
  return 'continue';
}
