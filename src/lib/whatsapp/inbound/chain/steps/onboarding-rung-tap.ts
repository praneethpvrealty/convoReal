import {
  budgetBandAcknowledgement,
  handleBudgetBandReply,
  BUDGET_BAND_ID_PREFIX,
} from '@/lib/whatsapp/budget-band';
import {
  propertyTypeAcknowledgement,
  handlePropertyTypeReply,
  PROPERTY_TYPE_ID_PREFIX,
} from '@/lib/whatsapp/property-type-prompt';
import {
  listingIntentAcknowledgement,
  handleListingIntentReply,
  LISTING_INTENT_ID_PREFIX,
} from '@/lib/whatsapp/listing-intent-prompt';
import { sendAlertsOnboarding } from '@/lib/whatsapp/alerts-onboarding';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { InboundChainContext, StepResult } from '../context';

export async function onboardingRungTap(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    configOwnerUserId,
    interactiveReplyId,
    contactRecord,
    conversation,
  } = ctx;
  // A tapped property type or budget band. The tap saves the answer;
  // the onboarding ladder then sends whichever rung is still missing,
  // or the re-ranked shortlist when the profile is complete — the
  // answer that makes tapping worth it.
  if (
    interactiveReplyId?.startsWith(PROPERTY_TYPE_ID_PREFIX) ||
    interactiveReplyId?.startsWith(LISTING_INTENT_ID_PREFIX) ||
    interactiveReplyId?.startsWith(BUDGET_BAND_ID_PREFIX)
  ) {
    const rungArgs = {
      db: supabaseAdmin(),
      accountId,
      contactId: contactRecord.id,
      replyId: interactiveReplyId,
    };
    const handledRung = interactiveReplyId.startsWith(PROPERTY_TYPE_ID_PREFIX)
      ? await handlePropertyTypeReply(rungArgs)
      : interactiveReplyId.startsWith(LISTING_INTENT_ID_PREFIX)
        ? await handleListingIntentReply(rungArgs)
        : await handleBudgetBandReply(rungArgs);
    if (handledRung) {
      const acknowledgement = interactiveReplyId.startsWith(
        PROPERTY_TYPE_ID_PREFIX
      )
        ? propertyTypeAcknowledgement(interactiveReplyId)
        : interactiveReplyId.startsWith(LISTING_INTENT_ID_PREFIX)
          ? listingIntentAcknowledgement(interactiveReplyId)
          : budgetBandAcknowledgement(interactiveReplyId);
      await sendAlertsOnboarding({
        db: supabaseAdmin(),
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        acknowledgement,
      });
      return 'handled';
    }
  }
  return 'continue';
}
