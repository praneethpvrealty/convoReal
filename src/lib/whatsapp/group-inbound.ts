/**
 * Inbound messages sent by a group participant.
 *
 * These do NOT arrive on a group-specific webhook field. Meta delivers
 * them on the ordinary `messages` field, with one difference: the
 * message object carries a `group_id`, and `from` / `contacts[].wa_id`
 * identify the PARTICIPANT who wrote it rather than the group.
 *
 * That similarity is the hazard. Without the check below, the existing
 * 1:1 path sees a normal inbound message from a phone number and files
 * it in that person's own thread — so a message meant for a deal group
 * lands in a private conversation, and the bot answers the participant
 * directly. Detection has to happen before any of that runs.
 *
 * On shape: Meta's reference documents the field's existence and
 * meaning but does not publish a raw JSON example of a group inbound.
 * `groupIdFromInbound` therefore reads it from the message object first
 * and the value envelope second, and returns null when neither carries
 * one — in which case behaviour is exactly what it was before groups
 * existed. A shape we have not seen degrades to the old path rather
 * than to a wrong one.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';

export interface InboundGroupRef {
  group_id?: string | null;
}

/**
 * Meta's group id for an inbound message, or null when it is an
 * ordinary one-to-one message.
 */
export function groupIdFromInbound(
  message: InboundGroupRef | null | undefined,
  value?: InboundGroupRef | null,
): string | null {
  const fromMessage = message?.group_id;
  if (typeof fromMessage === 'string' && fromMessage.trim()) {
    return fromMessage.trim();
  }
  const fromValue = value?.group_id;
  if (typeof fromValue === 'string' && fromValue.trim()) {
    return fromValue.trim();
  }
  return null;
}

/** Whether this inbound belongs to a group thread. */
export function isGroupInbound(
  message: InboundGroupRef | null | undefined,
  value?: InboundGroupRef | null,
): boolean {
  return groupIdFromInbound(message, value) !== null;
}

export interface ResolvedGroupThread {
  groupRowId: string;
  conversationId: string;
}

/**
 * The conversation an inbound group message belongs to.
 *
 * Returns null for a group this account does not have a row for. That
 * is deliberate: a group id we have never seen means either another
 * tenant's group on a shared number, or one created outside the Engine
 * whose lifecycle webhook has not landed. Inventing a row from an
 * inbound message would create groups we cannot manage — we would have
 * no invite link, no subject, and no participant list for it.
 */
export async function resolveGroupThread(
  accountId: string,
  waGroupId: string,
): Promise<ResolvedGroupThread | null> {
  const db = supabaseAdmin();

  const { data: group } = await db
    .from('whatsapp_groups')
    .select('id, status')
    .eq('account_id', accountId)
    .eq('wa_group_id', waGroupId)
    .maybeSingle();

  if (!group) return null;

  const { data: existing } = await db
    .from('conversations')
    .select('id')
    .eq('group_id', group.id)
    .maybeSingle();

  if (existing) {
    return { groupRowId: group.id, conversationId: existing.id };
  }

  // The lifecycle webhook normally opens this. A message arriving first
  // (webhooks are not ordered) should still land somewhere.
  const { data: created, error } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      group_id: group.id,
      contact_id: null,
      status: 'open',
    })
    .select('id')
    .single();

  if (error || !created) {
    console.error('[group-inbound] could not open conversation:', error?.message);
    return null;
  }
  return { groupRowId: group.id, conversationId: created.id };
}

/**
 * Which contact wrote this, when we already know them.
 *
 * Unmatched senders stay null rather than becoming new contacts.
 * Someone who followed an invite link into a group has not asked to be
 * a lead of this brokerage, and auto-creating one would put them into
 * matching, digests and broadcasts off the back of a group join.
 */
export async function resolveGroupSender(
  accountId: string,
  waId: string,
): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from('contacts')
    .select('id')
    .eq('account_id', accountId)
    .eq('phone', waId)
    .maybeSingle();
  return data?.id ?? null;
}
