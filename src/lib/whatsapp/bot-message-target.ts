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

/**
 * The newest card of one entity type still standing in a thread.
 *
 * A quote-reply names its card exactly; a plain reply names nothing.
 * But a bot that asks "how did it go?" and then cannot read the answer
 * typed straight back at it is asking a question it does not want
 * answered — WhatsApp makes quoting an extra deliberate gesture, and
 * agents reply the way they would to a person.
 *
 * Bounded on both ends: the last few bot messages of one conversation,
 * none older than `withinHours`. Beyond that the thread has moved on
 * and a stray "done" belongs to something else.
 */
export async function latestBotTarget(params: {
  accountId: string;
  conversationId: string;
  entityType: BotTargetEntity;
  withinHours?: number;
  client?: SupabaseClient;
}): Promise<BotTarget | null> {
  try {
    const db = params.client || supabaseAdmin();
    const since = new Date(
      Date.now() - (params.withinHours ?? 48) * 60 * 60 * 1000
    ).toISOString();

    const { data: recent, error: msgErr } = await db
      .from('messages')
      .select('message_id, created_at')
      .eq('conversation_id', params.conversationId)
      .eq('sender_type', 'bot')
      .not('message_id', 'is', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(10);
    if (msgErr) {
      console.error('[bot-target] recent lookup failed:', msgErr);
      return null;
    }

    const wamids = (recent || [])
      .map((m) => m.message_id as string | null)
      .filter((id): id is string => !!id);
    if (!wamids.length) return null;

    const { data, error } = await db
      .from('bot_message_targets')
      .select('entity_type, entity_id, wa_message_id')
      .eq('account_id', params.accountId)
      .eq('entity_type', params.entityType)
      .in('wa_message_id', wamids);
    if (error) {
      console.error('[bot-target] recent target lookup failed:', error);
      return null;
    }
    if (!data?.length) return null;

    // wamids is newest-first, so the earliest index is the newest card.
    const byWamid = new Map(data.map((t) => [t.wa_message_id as string, t]));
    for (const id of wamids) {
      const hit = byWamid.get(id);
      if (hit) {
        return {
          entityType: hit.entity_type as BotTargetEntity,
          entityId: hit.entity_id as string,
        };
      }
    }
    return null;
  } catch (err) {
    console.error('[bot-target] recent lookup threw:', err);
    return null;
  }
}

/**
 * The target of the newest bot message in a thread whose TEXT matches
 * `prompt` — the card behind a specific question, rather than the
 * newest card of a type.
 *
 * A bot that asks "which property is this about?" has to be able to
 * read the answer typed straight back at it, and the answer names the
 * question by being next, not by quoting. Keying on the question's own
 * wamid keeps that unambiguous: an unrelated card of the same entity
 * type standing in the thread cannot be mistaken for the thing being
 * answered.
 */
export async function latestBotTargetForPrompt(params: {
  accountId: string;
  conversationId: string;
  entityType: BotTargetEntity;
  prompt: RegExp;
  withinHours?: number;
  client?: SupabaseClient;
}): Promise<BotTarget | null> {
  try {
    const db = params.client || supabaseAdmin();
    const since = new Date(
      Date.now() - (params.withinHours ?? 48) * 60 * 60 * 1000
    ).toISOString();

    const { data: recent, error: msgErr } = await db
      .from('messages')
      .select('message_id, content_text, created_at')
      .eq('conversation_id', params.conversationId)
      .eq('sender_type', 'bot')
      .not('message_id', 'is', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(10);
    if (msgErr) {
      console.error('[bot-target] prompt lookup failed:', msgErr);
      return null;
    }

    const wamids = (recent || [])
      .filter((m) => params.prompt.test((m.content_text as string) || ''))
      .map((m) => m.message_id as string | null)
      .filter((id): id is string => !!id);
    if (!wamids.length) return null;

    const { data, error } = await db
      .from('bot_message_targets')
      .select('entity_type, entity_id, wa_message_id')
      .eq('account_id', params.accountId)
      .eq('entity_type', params.entityType)
      .in('wa_message_id', wamids);
    if (error) {
      console.error('[bot-target] prompt target lookup failed:', error);
      return null;
    }
    if (!data?.length) return null;

    const byWamid = new Map(data.map((t) => [t.wa_message_id as string, t]));
    for (const id of wamids) {
      const hit = byWamid.get(id);
      if (hit) {
        return {
          entityType: hit.entity_type as BotTargetEntity,
          entityId: hit.entity_id as string,
        };
      }
    }
    return null;
  } catch (err) {
    console.error('[bot-target] prompt lookup threw:', err);
    return null;
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
    return {
      entityType: data.entity_type as BotTargetEntity,
      entityId: data.entity_id as string,
    };
  } catch (err) {
    console.error('[bot-target] lookup threw:', err);
    return null;
  }
}
