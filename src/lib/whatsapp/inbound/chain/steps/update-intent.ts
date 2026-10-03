import {
  handleUpdateIntent,
  parseUpdateIntent,
} from '@/lib/whatsapp/inbound/update-sessions';
import type { InboundChainContext, StepResult } from '../context';

export async function updateIntent(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    configOwnerUserId,
    senderPhone,
    contentText,
    contactRecord,
    conversation,
  } = ctx;
  // Check for update intent. Allowed for account staff (owner/admin/agent,
  // org_manager/org_leader) or the WhatsApp contact that owns the target
  // record (their own contact, or a property they listed). Unauthorized
  // senders fall through to normal handling so they cannot mutate records
  // and never learn the feature exists.
  const updateIntent = parseUpdateIntent(contentText || '');
  if (updateIntent && updateIntent.type) {
    const handledUpdate = await handleUpdateIntent(
      updateIntent as { type: 'property' | 'contact'; identifier?: string },
      accountId,
      configOwnerUserId,
      contactRecord,
      conversation,
      senderPhone
    );
    if (handledUpdate) return 'handled';
  }
  return 'continue';
}
