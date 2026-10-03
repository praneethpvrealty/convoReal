import { handleTimelineTemplateTap } from '@/lib/journey/client-response';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { InboundChainContext, StepResult } from '../context';

export async function timelineTemplateTap(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    message,
    configOwnerUserId,
    senderPhone,
    contactRecord,
    conversation,
  } = ctx;
  // Buyer alert subscription control — "STOP ALERTS" / "START ALERTS"
  // free text, editing contacts.buyer_alerts_consent (same
  // chat-as-control-panel pattern as the owner digest commands above),
  // and the enquiry templates' "Close my enquiry" quick reply, which
  // arrives as message.button.text and closes one listing's enquiry.
  //
  // "Still considering it" on the journey check-in template: the tap is
  // the client's answer — log it on the journey and ask for a timeline.
  //
  // Matched on the ACTION, so a lead who was sent the Kannada template
  // and taps "ಇನ್ನೂ ಪರಿಶೀಲಿಸುತ್ತಿದೆ" lands here too. What gets LOGGED is
  // still the English constant, so the journey reads one stable phrase
  // whatever language the client was messaged in.
  // The lead picking when to be checked back on, from the enquiry
  // timeline template. Matched on the action so any language lands
  // here; the journey item comes from their own latest logged
  // response, since a template quick reply carries no id to encode it.
  if (message.button?.text) {
    const handledTimeline = await handleTimelineTemplateTap({
      db: supabaseAdmin(),
      accountId,
      ownerUserId: configOwnerUserId,
      contact: {
        id: contactRecord.id,
        name: contactRecord.name,
        phone: senderPhone,
      },
      conversationId: conversation.id,
      buttonText: message.button.text,
    });
    if (handledTimeline) return 'handled';
  }
  return 'continue';
}
