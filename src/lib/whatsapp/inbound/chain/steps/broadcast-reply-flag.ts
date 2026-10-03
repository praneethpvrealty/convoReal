import { flagBroadcastReplyIfAny } from '@/lib/whatsapp/inbound/broadcast-reply';
import type { InboundChainContext, StepResult } from '../context';

export async function broadcastReplyFlag(
  ctx: InboundChainContext
): Promise<StepResult> {
  const { accountId, contactRecord } = ctx;
  await flagBroadcastReplyIfAny(accountId, contactRecord.id);
  return 'continue';
}
