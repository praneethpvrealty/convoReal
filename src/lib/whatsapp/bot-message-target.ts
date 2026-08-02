// ============================================================
// What a bot confirmation card was about (migration 185).
//
// Every "✅ created/added" card the owner chatbot sends records the
// row it announced against its own wamid. WhatsApp puts that wamid
// on a quote-reply as context.id, so a correction typed against the
// card ("change this to Monday 5pm") can be routed to an edit of
// that row instead of being read as a fresh request.
//
// Recording is best-effort: a failure here must never turn a
// successful create into an error reply, it only costs the user the
// ability to quote-edit that one card.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';

export type BotTargetEntity = 'appointment' | 'todo' | 'contact' | 'property';

export interface BotTarget {
  entityType: BotTargetEntity;
  entityId: string;
}

export async function recordBotTarget(params: {
  accountId: string;
  waMessageId: string | null | undefined;
  entityType: BotTargetEntity;
  entityId: string;
  client?: SupabaseClient;
}): Promise<void> {
  if (!params.waMessageId) return;
  try {
    const db = params.client || supabaseAdmin();
    const { error } = await db.from('bot_message_targets').upsert(
      {
        account_id: params.accountId,
        wa_message_id: params.waMessageId,
        entity_type: params.entityType,
        entity_id: params.entityId,
      },
      { onConflict: 'account_id,wa_message_id' }
    );
    if (error) console.error('[bot-target] record failed:', error);
  } catch (err) {
    console.error('[bot-target] record threw:', err);
  }
}

/** The row a quote-reply is aimed at, or null when the reply quotes
 *  something that was never a confirmation card. */
export async function resolveBotTarget(params: {
  accountId: string;
  contextId: string | null | undefined;
  client?: SupabaseClient;
}): Promise<BotTarget | null> {
  if (!params.contextId) return null;
  try {
    const db = params.client || supabaseAdmin();
    const { data, error } = await db
      .from('bot_message_targets')
      .select('entity_type, entity_id')
      .eq('account_id', params.accountId)
      .eq('wa_message_id', params.contextId)
      .maybeSingle();
    if (error) {
      console.error('[bot-target] lookup failed:', error);
      return null;
    }
    if (!data) return null;
    return { entityType: data.entity_type as BotTargetEntity, entityId: data.entity_id as string };
  } catch (err) {
    console.error('[bot-target] lookup threw:', err);
    return null;
  }
}
