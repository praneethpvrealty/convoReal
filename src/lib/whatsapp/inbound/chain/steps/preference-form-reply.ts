import { handlePreferenceFlowNfmReply } from '@/lib/whatsapp/inbound/preference-flow-replies';
import type { InboundChainContext, StepResult } from '../context';

export async function preferenceFormReply(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    configOwnerUserId,
    nfmResponseJson,
    contactRecord,
    conversation,
  } = ctx;
  // Completed native Meta Flow (form-screen) submission — e.g. the
  // Buyer Preference Intake form. The encrypted data-exchange endpoint
  // has usually already persisted the values at submit time; this path
  // is the idempotent fallback plus the in-chat confirmation.
  if (nfmResponseJson) {
    await handlePreferenceFlowNfmReply(
      nfmResponseJson,
      accountId,
      configOwnerUserId,
      contactRecord.id,
      conversation.id
    );
    return 'handled';
  }
  return 'continue';
}
