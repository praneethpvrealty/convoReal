import { isBuyerRequirementMessage } from '@/lib/ai/lead-routing';
import { isEngineControlReplyId } from '@/lib/whatsapp/control-reply-ids';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isEarliestCustomerMessage } from '@/lib/whatsapp/serialized-inbound';
import type { InboundChainContext, InboundChainPayload } from './context';
import { INBOUND_STEPS } from './steps';

async function reloadRow<T extends { id: string }>(
  table: 'contacts' | 'conversations',
  accountId: string,
  row: T
): Promise<T> {
  const { data, error } = await supabaseAdmin()
    .from(table)
    .select('*')
    .eq('id', row.id)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    console.error(`[webhook] reloading ${table} ${row.id} failed:`, error);
  }
  return data ? { ...row, ...(data as Partial<T>) } : row;
}

async function buildInboundChainContext(
  payload: InboundChainPayload,
  { waited }: { waited: boolean },
  accountId: string,
  accessToken: string
): Promise<InboundChainContext> {
  const {
    message,
    configOwnerUserId,
    phoneNumberId,
    senderPhone,
    contactWasCreated,
    contentText,
    interactiveReplyId,
    nfmResponseJson,
    routingUpdate,
    enquiryPropertyId,
    enquiryIsDeliberate,
    enquiryPropertyTitle,
    enquiryPropertyStatus = null,
    specificPropertyInterest,
    propertyReferenceNeedsAgent,
    ownerCheck,
  } = payload;
  const contactRecord = waited
    ? await reloadRow('contacts', accountId, payload.contactRecord)
    : payload.contactRecord;
  const conversation = waited
    ? await reloadRow('conversations', accountId, payload.conversation)
    : payload.conversation;
  const isFirstInboundMessage =
    payload.isFirstInboundMessage &&
    (await isEarliestCustomerMessage(conversation.id, message.id));
  const isControlReply = Boolean(
    interactiveReplyId && isEngineControlReplyId(interactiveReplyId)
  );
  // The agent this lead is routed to (freshly resolved above, or a prior
  // assignment), falling back to the account owner. Used to target
  // booking + new-lead notifications at the right person.
  const assignedAgentUserId =
    routingUpdate.assigned_agent_id ||
    (conversation as { assigned_agent_id?: string | null }).assigned_agent_id ||
    configOwnerUserId;

  // An inbound reply makes an unset buyer HOT. Portal imports, property
  // matching and outbound messages never reach this branch.
  const isTextMessage = message.type === 'text';
  const buyerRequirementMessage =
    !ownerCheck.isOwner &&
    isTextMessage &&
    isBuyerRequirementMessage(contentText);

  return {
    accountId,
    accessToken,
    message,
    configOwnerUserId,
    phoneNumberId,
    senderPhone,
    contactWasCreated,
    contentText,
    interactiveReplyId,
    nfmResponseJson,
    routingUpdate,
    enquiryPropertyId,
    enquiryIsDeliberate,
    enquiryPropertyTitle,
    enquiryPropertyStatus,
    specificPropertyInterest,
    propertyReferenceNeedsAgent,
    ownerCheck,
    contactRecord,
    conversation,
    isFirstInboundMessage,
    isControlReply,
    assignedAgentUserId,
    isTextMessage,
    buyerRequirementMessage,
    ownedListings: [],
    isPropertyOwnerSender: false,
    agentHandling: false,
    inboundText: '',
    tappedHumanRequest: null,
    flowConsumed: false,
  };
}

export async function handleInboundChain(
  payload: InboundChainPayload,
  options: { waited: boolean },
  accountId: string,
  accessToken: string
) {
  const ctx = await buildInboundChainContext(
    payload,
    options,
    accountId,
    accessToken
  );
  for (const step of INBOUND_STEPS) {
    if ((await step.run(ctx)) === 'handled') return;
  }
}
