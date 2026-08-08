/**
 * Group webhook events.
 *
 * Groups report almost everything asynchronously, which is why this
 * file exists rather than a few branches in webhook-handler.ts:
 *
 *   group_lifecycle_update    create/delete, and the ONLY place the
 *                             real group id ever appears
 *   group_participants_update joins, leaves, removals, join requests
 *   group_settings_update     subject/description/picture changes
 *   group_status_update       suspension and its lifting
 *
 * A create is correlated by `request_id`, which we stored when the POST
 * returned. Without that correlation a second group created in the same
 * minute would be indistinguishable from the first.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { openGroupConversation } from '@/lib/whatsapp/group-inbound';

/** The webhook `field` values a group subscription delivers. */
export const GROUP_WEBHOOK_FIELDS = [
  'group_lifecycle_update',
  'group_participants_update',
  'group_settings_update',
  'group_status_update',
] as const;

export type GroupWebhookField = (typeof GROUP_WEBHOOK_FIELDS)[number];

export function isGroupWebhookField(field: string): field is GroupWebhookField {
  return (GROUP_WEBHOOK_FIELDS as readonly string[]).includes(field);
}

interface LifecyclePayload {
  type?: string;
  group_id?: string;
  request_id?: string;
  subject?: string;
  invite_link?: string;
  join_approval_mode?: string;
  errors?: { message?: string; title?: string }[];
}

interface ParticipantsPayload {
  group_id?: string;
  type?: string;
  added_participants?: { wa_id?: string; user_id?: string }[];
  removed_participants?: { wa_id?: string; user_id?: string; input?: string }[];
}

interface SettingsPayload {
  group_id?: string;
  group_subject?: { value?: string; update_successful?: boolean };
  group_description?: { value?: string; update_successful?: boolean };
}

interface StatusPayload {
  group_id?: string;
  type?: string;
}

function participantId(
  entry: { wa_id?: string; user_id?: string; input?: string } | undefined,
): string | null {
  return entry?.wa_id || entry?.user_id || entry?.input || null;
}

/**
 * Complete or fail a pending group row.
 *
 * The POST that started this stored `request_id` and an invite link but
 * had no group id to store — this is where it arrives.
 */
async function handleLifecycle(accountId: string, payload: LifecyclePayload) {
  const db = supabaseAdmin();
  const failed = Boolean(payload.errors?.length);

  if (payload.type === 'group_delete') {
    if (!payload.group_id) return;
    await db
      .from('whatsapp_groups')
      .update({ status: 'deleted' })
      .eq('account_id', accountId)
      .eq('wa_group_id', payload.group_id);
    return;
  }

  // A create. Match on the request id we issued; fall back to the group
  // id for a group created outside the Engine and seen here first.
  const match = payload.request_id
    ? { column: 'request_id', value: payload.request_id }
    : payload.group_id
      ? { column: 'wa_group_id', value: payload.group_id }
      : null;
  if (!match) return;

  const { data: group } = await db
    .from('whatsapp_groups')
    .select('id')
    .eq('account_id', accountId)
    .eq(match.column, match.value)
    .maybeSingle();

  if (!group) return;

  await db
    .from('whatsapp_groups')
    .update({
      ...(payload.group_id ? { wa_group_id: payload.group_id } : {}),
      ...(payload.subject ? { subject: payload.subject } : {}),
      ...(payload.invite_link ? { invite_link: payload.invite_link } : {}),
      status: failed ? 'failed' : 'active',
      error_message: failed
        ? (payload.errors?.[0]?.message ?? payload.errors?.[0]?.title ?? 'Group creation failed')
        : null,
    })
    .eq('id', group.id);

  // A group with no thread is invisible in the inbox, so the
  // conversation is created the moment the group becomes real.
  if (!failed) {
    const { data: existing } = await db
      .from('conversations')
      .select('id')
      .eq('group_id', group.id)
      .maybeSingle();

    if (!existing) {
      // Shared with the inbound path, which is what supplies the
      // NOT NULL user_id a group thread has no acting user for.
      await openGroupConversation(accountId, group.id);
    }
  }
}

/**
 * Joins and leaves. Participants are matched to an existing contact by
 * phone where we have one — a group member who is already a lead should
 * read as that lead, not as a bare number — but an unmatched joiner is
 * left unlinked rather than being invented as a contact: someone who
 * followed an invite link has not consented to becoming a lead record.
 */
async function handleParticipants(
  accountId: string,
  payload: ParticipantsPayload,
) {
  if (!payload.group_id) return;
  const db = supabaseAdmin();

  const { data: group } = await db
    .from('whatsapp_groups')
    .select('id')
    .eq('account_id', accountId)
    .eq('wa_group_id', payload.group_id)
    .maybeSingle();
  if (!group) return;

  const added = (payload.added_participants ?? [])
    .map(participantId)
    .filter((id): id is string => Boolean(id));

  const removed = (payload.removed_participants ?? [])
    .map(participantId)
    .filter((id): id is string => Boolean(id));

  for (const waId of added) {
    const { data: contact } = await db
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      .eq('phone', waId)
      .maybeSingle();

    await db.from('whatsapp_group_participants').upsert(
      {
        account_id: accountId,
        group_id: group.id,
        wa_id: waId,
        contact_id: contact?.id ?? null,
        joined_at: new Date().toISOString(),
        // A rejoin clears the earlier departure.
        left_at: null,
      },
      { onConflict: 'group_id,wa_id' },
    );
  }

  for (const waId of removed) {
    await db
      .from('whatsapp_group_participants')
      .update({ left_at: new Date().toISOString() })
      .eq('group_id', group.id)
      .eq('wa_id', waId);
  }

  if (added.length || removed.length) {
    const { count } = await db
      .from('whatsapp_group_participants')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', group.id)
      .is('left_at', null);

    await db
      .from('whatsapp_groups')
      .update({ participant_count: count ?? 0 })
      .eq('id', group.id);
  }
}

async function handleSettings(accountId: string, payload: SettingsPayload) {
  if (!payload.group_id) return;
  const db = supabaseAdmin();

  const patch: Record<string, string> = {};
  if (payload.group_subject?.update_successful && payload.group_subject.value) {
    patch.subject = payload.group_subject.value;
  }
  if (
    payload.group_description?.update_successful &&
    payload.group_description.value
  ) {
    patch.description = payload.group_description.value;
  }
  if (Object.keys(patch).length === 0) return;

  await db
    .from('whatsapp_groups')
    .update(patch)
    .eq('account_id', accountId)
    .eq('wa_group_id', payload.group_id);
}

async function handleStatus(accountId: string, payload: StatusPayload) {
  if (!payload.group_id) return;
  const db = supabaseAdmin();

  const suspended = payload.type === 'group_suspend';
  await db
    .from('whatsapp_groups')
    .update({ status: suspended ? 'suspended' : 'active' })
    .eq('account_id', accountId)
    .eq('wa_group_id', payload.group_id);
}

/**
 * Dispatch one group webhook change. Unknown fields and unknown event
 * types are ignored rather than thrown on: Meta adds event types without
 * notice, and a webhook that 500s is retried indefinitely.
 */
export async function processGroupWebhook(
  accountId: string,
  field: string,
  value: unknown,
): Promise<void> {
  if (!isGroupWebhookField(field) || !value || typeof value !== 'object') return;

  try {
    switch (field) {
      case 'group_lifecycle_update':
        await handleLifecycle(accountId, value as LifecyclePayload);
        return;
      case 'group_participants_update':
        await handleParticipants(accountId, value as ParticipantsPayload);
        return;
      case 'group_settings_update':
        await handleSettings(accountId, value as SettingsPayload);
        return;
      case 'group_status_update':
        await handleStatus(accountId, value as StatusPayload);
        return;
    }
  } catch (error) {
    console.error(`[group-webhook] ${field} failed:`, error);
  }
}
