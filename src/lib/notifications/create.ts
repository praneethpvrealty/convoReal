// ============================================================
// createNotification — the single entry point for alerting an
// internal user (the assigned agent / account owner) about
// something that happened in their account. It fans out to up to
// three channels from one call:
//
//   1. in-app  — a `notifications` row the dashboard bell reads
//                live over Supabase realtime.
//   2. whatsapp — a free-form text to the user's own WhatsApp
//                (profiles.phone), reusing the agent-ping pattern. A
//                ping about a conversation is registered as a reply
//                bridge, so answering it in WhatsApp reaches the
//                contact (whatsapp/reply-bridge.ts).
//   3. push    — an Expo push to the user's mobile devices.
//
// Every channel is best-effort and independent: a failure in one
// never blocks the others, and the whole call never throws. Callers
// pick channels per event (reminders already send their own
// WhatsApp, so they pass whatsapp:false and add in-app + push).
// ============================================================

import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  sendWhatsAppMessageAndPersist,
  type DispatcherResult,
} from '@/lib/whatsapp/meta-api-dispatcher';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { sendExpoPush } from '@/lib/notifications/push';
import { resolveChannels } from '@/lib/notifications/preferences';
import { registerReplyBridge } from '@/lib/whatsapp/reply-bridge';
import {
  resolveQuietPeriod,
  type QuietAudience,
} from '@/lib/notifications/quiet-hours';
import { recordBotTarget } from '@/lib/whatsapp/bot-message-target';

export type NotificationType =
  | 'appointment_booked'
  | 'new_message'
  | 'appointment_reminder'
  | 'todo_reminder'
  | 'appointment_overdue'
  | 'daily_digest'
  | 'teammate_update'
  | 'location_request'
  | 'subscription_extended'
  | 'listing_interest';

export interface NotificationChannels {
  inApp?: boolean;
  whatsapp?: boolean;
  push?: boolean;
}

export interface CreateNotificationInput {
  accountId: string;
  /** Recipient — the assigned agent / account owner being alerted. */
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  link?: string | null;
  channels?: NotificationChannels;
  /** Catalog event key (src/lib/notifications/events.ts). When set and
   *  `channels` is not passed, the channels come from the account's saved
   *  Settings → Notifications preferences (falling back to the event's
   *  defaults). Explicit `channels` always wins. */
  eventKey?: string;
  /** Overrides the WhatsApp body when it should differ from title/body. */
  whatsappText?: string | null;
  /** Reminder audience whose configured quiet period delays WhatsApp and push. */
  quietAudience?: QuietAudience;
}

export interface NotificationResult {
  inAppId: string | null;
  whatsapp: DispatcherResult | null;
  pushCount: number;
}

const DEFAULT_CHANNELS: Required<NotificationChannels> = {
  inApp: true,
  whatsapp: true,
  push: true,
};

export async function createNotification(
  input: CreateNotificationInput
): Promise<NotificationResult> {
  const result: NotificationResult = {
    inAppId: null,
    whatsapp: null,
    pushCount: 0,
  };
  if (!input.userId || !input.accountId) return result;

  const resolved =
    input.channels ??
    (input.eventKey
      ? await resolveChannels(input.accountId, input.eventKey)
      : undefined);
  const channels = { ...DEFAULT_CHANNELS, ...(resolved || {}) };
  const admin = supabaseAdmin();

  if (channels.inApp) {
    try {
      const { data, error } = await admin
        .from('notifications')
        .insert({
          account_id: input.accountId,
          user_id: input.userId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          entity_type: input.entityType ?? null,
          entity_id: input.entityId ?? null,
          link: input.link ?? null,
        })
        .select('id')
        .single();
      if (error) console.error('[notify] in-app insert failed:', error);
      else result.inAppId = data.id as string;
    } catch (err) {
      console.error('[notify] in-app insert error:', err);
    }
  }

  const whatsappText =
    input.whatsappText ??
    (input.body ? `${input.title}\n\n${input.body}` : input.title);

  if (input.quietAudience && (channels.whatsapp || channels.push)) {
    const quiet = await resolveQuietPeriod(
      input.accountId,
      input.quietAudience
    );
    if (quiet.isQuiet && quiet.deliverAt) {
      try {
        const { error } = await admin
          .from('deferred_notification_deliveries')
          .insert({
            account_id: input.accountId,
            user_id: input.userId,
            due_at: quiet.deliverAt.toISOString(),
            send_whatsapp: channels.whatsapp,
            send_push: channels.push,
            notification_type: input.type,
            title: input.title,
            body: input.body ?? null,
            whatsapp_text: whatsappText,
            entity_type: input.entityType ?? null,
            entity_id: input.entityId ?? null,
            link: input.link ?? null,
          });
        if (error) throw error;
        return result;
      } catch (error) {
        console.error('[notify] quiet-hours queue insert failed:', error);
        return result;
      }
    }
  }

  const [wa, push] = await Promise.all([
    channels.whatsapp
      ? pingUserWhatsApp(
          input.accountId,
          input.userId,
          whatsappText,
          input.entityType === 'conversation' ? (input.entityId ?? null) : null
        )
      : Promise.resolve(null),
    channels.push
      ? sendExpoPush(input.userId, {
          title: input.title,
          body: input.body || input.title,
          data: {
            type: input.type,
            entityType: input.entityType ?? null,
            entityId: input.entityId ?? null,
            link: input.link ?? null,
          },
        })
      : Promise.resolve(0),
  ]);
  result.whatsapp = wa;
  result.pushCount = push;
  return result;
}

interface DeferredNotificationDelivery {
  id: string;
  account_id: string;
  user_id: string;
  send_whatsapp: boolean;
  send_push: boolean;
  notification_type: NotificationType;
  title: string;
  body: string | null;
  whatsapp_text: string | null;
  entity_type: string | null;
  entity_id: string | null;
  link: string | null;
}

export async function deliverDeferredNotifications(
  now: Date = new Date()
): Promise<number> {
  const admin = supabaseAdmin();
  const staleClaim = new Date(now.getTime() - 10 * 60_000).toISOString();
  const { data, error } = await admin
    .from('deferred_notification_deliveries')
    .select(
      'id, account_id, user_id, send_whatsapp, send_push, notification_type, title, body, whatsapp_text, entity_type, entity_id, link'
    )
    .is('processed_at', null)
    .or(`claimed_at.is.null,claimed_at.lt.${staleClaim}`)
    .lte('due_at', now.toISOString())
    .order('due_at', { ascending: true })
    .limit(100);

  if (error) {
    console.error('[notify] deferred delivery fetch failed:', error);
    return 0;
  }

  let processed = 0;
  for (const raw of data || []) {
    const row = raw as DeferredNotificationDelivery;
    const { data: claim, error: claimError } = await admin
      .from('deferred_notification_deliveries')
      .update({ claimed_at: now.toISOString() })
      .eq('id', row.id)
      .eq('account_id', row.account_id)
      .is('processed_at', null)
      .or(`claimed_at.is.null,claimed_at.lt.${staleClaim}`)
      .select('id')
      .maybeSingle();
    if (claimError || !claim) continue;

    const [whatsappResult] = await Promise.all([
      row.send_whatsapp
        ? pingUserWhatsApp(
            row.account_id,
            row.user_id,
            row.whatsapp_text || row.body || row.title,
            row.entity_type === 'conversation' ? row.entity_id : null
          )
        : Promise.resolve(null),
      row.send_push
        ? sendExpoPush(row.user_id, {
            title: row.title,
            body: row.body || row.title,
            data: {
              type: row.notification_type,
              entityType: row.entity_type,
              entityId: row.entity_id,
              link: row.link,
            },
          })
        : Promise.resolve(0),
    ]);
    if (
      whatsappResult?.success &&
      row.entity_type === 'appointment' &&
      row.entity_id
    ) {
      await recordBotTarget({
        accountId: row.account_id,
        waMessageId: whatsappResult.whatsappMessageId,
        entityType: 'appointment',
        entityId: row.entity_id,
        client: admin,
      });
    }
    const { error: completeError } = await admin
      .from('deferred_notification_deliveries')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('account_id', row.account_id);
    if (completeError) {
      console.error(
        '[notify] deferred delivery completion failed:',
        completeError
      );
      continue;
    }
    processed += 1;
  }

  return processed;
}

async function pingUserWhatsApp(
  accountId: string,
  userId: string,
  text: string,
  /** Thread the ping is about, when it is one — makes the ping answerable. */
  bridgeConversationId: string | null
): Promise<DispatcherResult | null> {
  try {
    const { data: profile } = await supabaseAdmin()
      .from('profiles')
      .select('phone')
      .eq('user_id', userId)
      .maybeSingle();
    if (!profile?.phone) return null;
    const phone = sanitizePhoneForMeta(profile.phone);
    if (!isValidE164(phone)) return null;
    const result = await sendWhatsAppMessageAndPersist({
      accountId,
      userId,
      toPhone: phone,
      kind: 'text',
      senderType: 'bot',
      text,
    });

    // A ping about a conversation is answerable: register it so a
    // WhatsApp quote-reply reaches the contact instead of the chatbot.
    if (result.success && bridgeConversationId) {
      await registerReplyBridge({
        accountId,
        agentUserId: userId,
        agentPhone: phone,
        wamid: result.whatsappMessageId,
        conversationId: bridgeConversationId,
      });
    }
    return result;
  } catch (err) {
    console.error('[notify] whatsapp ping failed:', err);
    return null;
  }
}
