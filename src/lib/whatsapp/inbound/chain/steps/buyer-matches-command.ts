import { parseBuyerMatchesCommand } from '@/lib/buyer/digest';
import { buildBuyerMatchReplyWithListings } from '@/lib/buyer/match-reply';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logListingsSent } from '@/lib/whatsapp/share-property-send';
import type { InboundChainContext, StepResult } from '../context';

export async function buyerMatchesCommand(
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
  // On-demand matches — "MATCHES" / "show my matches" in the buyer's
  // chat. They just opened the 24-hour window by texting, so the reply
  // is free-form: no template, nothing to get approved first. Falls
  // through when the buyer has no brief or nothing fits.
  // A template quick reply arrives as message.button.text rather than
  // as message text, so read both — otherwise a tap that plainly says
  // "send listings" would fall through to generic handling.
  if (parseBuyerMatchesCommand(message.button?.text ?? contentText)) {
    const matchReply = await buildBuyerMatchReplyWithListings({
      accountId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
    });
    if (matchReply) {
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        kind: 'text',
        senderType: 'bot',
        text: matchReply.text,
      });
      await logListingsSent(
        supabaseAdmin(),
        accountId,
        configOwnerUserId,
        contactRecord.id,
        matchReply.propertyIds
      );
      return 'handled';
    }
  }
  return 'continue';
}
