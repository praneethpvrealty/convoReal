import { handleEnquiryClose } from '@/lib/whatsapp/enquiry-close';
import { matchTemplateButton } from '@/lib/whatsapp/template-copy';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { InboundChainContext, StepResult } from '../context';

export async function closeEnquiryTap(
  ctx: InboundChainContext
): Promise<StepResult> {
  const { accountId, message, configOwnerUserId, contactRecord, conversation } =
    ctx;
  // All three enquiry templates share one close action, and each one
  // ships in every language we send — so this matches on the ACTION,
  // resolved from the label in whatever language the lead received.
  // Comparing against the English constants (as this did) meant a
  // Kannada lead tapping "ವಿಚಾರಣೆ ಮುಚ್ಚಿ" was not closing anything:
  // their enquiry stayed open and the alerts kept coming.
  //
  // The close is scoped to the listing the template named: that
  // enquiry is filed as closed, the lead is told their other enquiries
  // stay open, and the tap's window runs the drop-off reason, the
  // open-enquiry review and the requirement ladder. The lead is marked
  // dead only when nothing names a listing and nothing is on their
  // journey — a search-level close.
  if (matchTemplateButton(message.button?.text) === 'close_enquiry') {
    await handleEnquiryClose({
      db: supabaseAdmin(),
      accountId,
      userId: configOwnerUserId,
      contact: contactRecord,
      conversationId: conversation.id,
      contextMessageId: message.context?.id ?? null,
    });
    return 'handled';
  }
  return 'continue';
}
