import { maybeAutoHeatContact } from '@/lib/contacts/auto-heat';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { InboundChainContext, StepResult } from '../context';

export async function autoHeat(ctx: InboundChainContext): Promise<StepResult> {
  const { accountId, ownerCheck, contactRecord } = ctx;
  if (!ownerCheck.isOwner) {
    await maybeAutoHeatContact({
      db: supabaseAdmin(),
      accountId,
      contact: contactRecord,
    });
  }
  return 'continue';
}
