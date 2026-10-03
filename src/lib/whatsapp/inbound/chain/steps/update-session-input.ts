import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  handleUpdateSessionInput,
  isAuthorizedForUpdateSession,
} from '@/lib/whatsapp/inbound/update-sessions';
import type { InboundChainContext, StepResult } from '../context';

export async function updateSessionInput(
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

  // Check for active update session
  const { data: activeUpdateSession } = await supabaseAdmin()
    .from('update_sessions')
    .select('*')
    .eq('contact_id', contactRecord.id)
    .eq('status', 'collecting')
    .maybeSingle();

  if (
    activeUpdateSession &&
    (await isAuthorizedForUpdateSession(
      activeUpdateSession,
      contactRecord,
      senderPhone,
      accountId
    ))
  ) {
    const handled = await handleUpdateSessionInput(
      activeUpdateSession.id,
      contentText || '',
      accountId,
      configOwnerUserId,
      contactRecord,
      conversation,
      senderPhone
    );
    if (handled) return 'handled';
  }
  return 'continue';
}
