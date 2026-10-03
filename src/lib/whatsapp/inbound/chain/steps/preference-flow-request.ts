import {
  isPreferenceFlowRequestText,
  PREFERENCE_FLOW_BUTTON_ID,
} from '@/lib/whatsapp/preference-flow';
import { handlePreferenceFlowTrigger } from '@/lib/whatsapp/inbound/preference-flow-replies';
import type { InboundChainContext, StepResult } from '../context';

export async function preferenceFlowRequest(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    message,
    configOwnerUserId,
    contentText,
    interactiveReplyId,
    contactRecord,
    conversation,
  } = ctx;
  // Buyer asked to update their preferences (free text like "update my
  // preferences", the update_preferences button, or the enquiry-followup
  // template's "Update my preferences" quick reply, which arrives as
  // message.button.text) — send the native Meta Flow form if this
  // account has one published. Falls through to normal handling when
  // the flow isn't set up, so accounts without the feature see no
  // behavior change.
  if (
    isPreferenceFlowRequestText(message.button?.text ?? contentText) ||
    interactiveReplyId === PREFERENCE_FLOW_BUTTON_ID
  ) {
    const handledPreferenceFlow = await handlePreferenceFlowTrigger(
      accountId,
      contactRecord.id,
      configOwnerUserId,
      conversation.id
    );
    if (handledPreferenceFlow) return 'handled';
  }
  return 'continue';
}
