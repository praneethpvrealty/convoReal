import {
  parseOwnerDigestCommand,
  applyOwnerDigestCommand,
  isBareOptOut,
  receivesUpdateDigest,
} from '@/lib/owners/owner-digest';
import { supabaseAdmin } from '@/lib/supabase/admin';
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
  const replyText = message.button?.text ?? contentText;
  const digestCommand =
    parseOwnerDigestCommand(replyText) ??
    (isBareOptOut(replyText) &&
    contactRecord.owner_digest_consent !== 'declined' &&
    (await receivesUpdateDigest(supabaseAdmin(), accountId, contactRecord.id))
      ? 'stop'
      : null);
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
