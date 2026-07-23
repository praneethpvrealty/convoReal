// ============================================================
// createNotification — the single entry point for alerting an
// internal user (the assigned agent / account owner) about
// something that happened in their account. It fans out to up to
// three channels from one call:
//
//   1. in-app  — a `notifications` row the dashboard bell reads
//                live over Supabase realtime.
//   2. whatsapp — a free-form text to the user's own WhatsApp
//                (profiles.phone), reusing the agent-ping pattern.
//   3. push    — an Expo push to the user's mobile devices.
//
// Every channel is best-effort and independent: a failure in one
// never blocks the others, and the whole call never throws. Callers
// pick channels per event (reminders already send their own
// WhatsApp, so they pass whatsapp:false and add in-app + push).
// ============================================================

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { sendWhatsAppMessageAndPersist, type DispatcherResult } from '@/lib/whatsapp/meta-api-dispatcher';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { sendExpoPush } from '@/lib/notifications/push';

export type NotificationType =
  | 'appointment_booked'
  | 'new_message'
  | 'appointment_reminder'
  | 'appointment_overdue'
  | 'daily_digest';

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
  /** Overrides the WhatsApp body when it should differ from title/body. */
  whatsappText?: string | null;
}

export interface NotificationResult {
  inAppId: string | null;
  whatsapp: DispatcherResult | null;
  pushCount: number;
}

const DEFAULT_CHANNELS: Required<NotificationChannels> = { inApp: true, whatsapp: true, push: true };

export async function createNotification(input: CreateNotificationInput): Promise<NotificationResult> {
  const result: NotificationResult = { inAppId: null, whatsapp: null, pushCount: 0 };
  if (!input.userId || !input.accountId) return result;

  const channels = { ...DEFAULT_CHANNELS, ...(input.channels || {}) };
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

  const whatsappText = input.whatsappText ?? (input.body ? `${input.title}\n\n${input.body}` : input.title);

  const [wa, push] = await Promise.all([
    channels.whatsapp ? pingUserWhatsApp(input.accountId, input.userId, whatsappText) : Promise.resolve(null),
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

async function pingUserWhatsApp(
  accountId: string,
  userId: string,
  text: string
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
    return await sendWhatsAppMessageAndPersist({
      accountId,
      userId,
      toPhone: phone,
      kind: 'text',
      senderType: 'bot',
      text,
    });
  } catch (err) {
    console.error('[notify] whatsapp ping failed:', err);
    return null;
  }
}
