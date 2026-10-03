import {
  claimOwnerConsentAsk,
  CONSENT_BUTTONS as OWNER_CONSENT_BUTTONS,
  type OwnerConsentFields,
} from '@/lib/owners/consent-ask';
import { handleOwnerInboundMessage } from '@/lib/owners/owner-reply';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { InboundChainContext, StepResult } from '../context';

export async function ownerInbound(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    message,
    configOwnerUserId,
    contactRecord,
    conversation,
    ownedListings,
    isPropertyOwnerSender,
    inboundText,
    flowConsumed,
  } = ctx;
  if (
    !flowConsumed &&
    isPropertyOwnerSender &&
    (message.type === 'text' || message.type === 'button')
  ) {
    const ownerHandled = await handleOwnerInboundMessage({
      accountId,
      userId: configOwnerUserId,
      contactId: contactRecord.id,
      contactName: contactRecord.name || null,
      conversationId: conversation.id,
      digestConsent: contactRecord.owner_digest_consent,
      preferredLanguage:
        (contactRecord as { preferred_language?: string | null })
          .preferred_language ?? null,
      text: message.button?.text ?? inboundText,
      listings: ownedListings,
    });
    if (ownerHandled) {
      // The owner's window is open — the one moment their digest consent
      // can be asked free-form, with buttons and no template. The cron
      // reaches only owners who happen to have messaged us in the last
      // 24 hours when it runs, and skips the rest entirely when the
      // account has no approved consent template.
      try {
        const ownerAsk = await claimOwnerConsentAsk(
          supabaseAdmin(),
          accountId,
          contactRecord as unknown as OwnerConsentFields,
          ownedListings
        );
        if (ownerAsk) {
          await sendWhatsAppMessageAndPersist({
            accountId,
            userId: configOwnerUserId,
            contactId: contactRecord.id,
            conversationId: conversation.id,
            kind: 'interactive',
            interactiveType: 'buttons',
            senderType: 'bot',
            interactiveBody: ownerAsk,
            interactiveButtons: OWNER_CONSENT_BUTTONS,
          });
        }
      } catch (err) {
        console.error('[owner-consent] ask failed (non-fatal):', err);
      }
      return 'handled';
    }
  }
  return 'continue';
}
