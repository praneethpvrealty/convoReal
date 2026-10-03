import { dispatchInboundToFlows } from '@/lib/flows/engine';
import { toFlowInbound } from '@/lib/flows/inbound-message';
import {
  looksLikeQuestion,
  quickReplyHumanRequest,
  repliesRatherThanOpens,
} from '@/lib/ai/lead-question';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { hasBeenSentAListing } from '@/lib/whatsapp/share-property-send';
import { logText } from '@/lib/whatsapp/inbound/log-text';
import type { InboundChainContext, StepResult } from '../context';

export async function flowDispatch(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    message,
    configOwnerUserId,
    contentText,
    interactiveReplyId,
    ownerCheck,
    contactRecord,
    conversation,
    isFirstInboundMessage,
    isTextMessage,
    buyerRequirementMessage,
    isPropertyOwnerSender,
    agentHandling,
  } = ctx;

  const inboundText = contentText ?? message.text?.body ?? '';
  const tappedHumanRequest = ownerCheck.isOwner
    ? null
    : quickReplyHumanRequest(message);

  const repliesToUs =
    tappedHumanRequest !== null ||
    (isTextMessage &&
      !ownerCheck.isOwner &&
      repliesRatherThanOpens(inboundText, {
        listingAlreadySent: looksLikeQuestion(inboundText)
          ? await hasBeenSentAListing(
              supabaseAdmin(),
              accountId,
              contactRecord.id
            )
          : false,
      }));

  console.log(
    `[webhook] Dispatching to flows. accountId=${accountId}, contact=${contactRecord.id}, text="${logText(inboundText)}"`
  );
  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    allowEntry:
      !isPropertyOwnerSender && !agentHandling && !buyerRequirementMessage,
    repliesRatherThanOpens: repliesToUs,
    message: toFlowInbound(
      message,
      contentText,
      interactiveReplyId,
      inboundText
    ),
    isFirstInboundMessage,
  });
  console.log(
    `[webhook] Flow result: consumed=${flowResult.consumed}, outcome=${flowResult.outcome || 'n/a'}, flow_run_id=${flowResult.flow_run_id || 'n/a'}`
  );
  const flowConsumed = flowResult.consumed;
  ctx.inboundText = inboundText;
  ctx.tappedHumanRequest = tappedHumanRequest;
  ctx.flowConsumed = flowConsumed;
  return 'continue';
}
