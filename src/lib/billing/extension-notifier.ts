// ============================================================
// Telling a customer their subscription was extended, across all three
// channels they might be reachable on: WhatsApp, email, and the in-app
// bell.
//
// Delivery is best-effort and deliberately non-blocking: a granted
// extension is real the moment its row is written, and a WhatsApp
// outage (quite plausibly the very thing being apologised for) must
// never roll it back. Every attempt is recorded on
// subscription_extensions.notification_result so a silent failure is
// visible in the admin panel and can be chased by a human.
//
// WhatsApp goes out from the PLATFORM sender, not the tenant's own
// WABA — ConvoReal is the one speaking here, and during an outage the
// tenant's own config may be exactly what is broken.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  sendTransactionalEmail,
  buildSubscriptionExtensionEmail,
} from '@/lib/email';
import { createNotification } from '@/lib/notifications/create';
import { sendPlatformTemplate } from '@/lib/whatsapp/platform-sender';
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import {
  buildExtensionFallbackText,
  buildExtensionNotificationCopy,
  buildExtensionTemplateParams,
  formatAccessDate,
  sentenceForReason,
  templateNameForTone,
  toneForReason,
} from '@/lib/whatsapp/subscription-extension-template';

export interface ExtensionNotice {
  extensionId: string;
  accountId: string;
  days: number;
  reason: string;
  customerMessage: string | null;
  newPeriodEnd: string | null;
}

export interface ChannelOutcome {
  whatsapp: { sent: boolean; via: string | null; error?: string } | null;
  email: { sent: boolean; error?: string } | null;
  inApp: { sent: boolean } | null;
}

export interface RecipientOutcome extends ChannelOutcome {
  userId: string;
}

interface OwnerProfile {
  user_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://www.convoreal.com'
  );
}

/**
 * Notifies every owner of one account about one granted extension.
 *
 * Owners, not all members: this is billing news, and `subscriptions` is
 * already owner-only under RLS. An agent seeing "your subscription was
 * extended" for an account they don't pay for would be noise.
 */
export async function notifyExtensionGranted(
  admin: SupabaseClient,
  notice: ExtensionNotice
): Promise<RecipientOutcome[]> {
  const { data: ownerRows } = await admin
    .from('profiles')
    .select('user_id, full_name, email, phone')
    .eq('account_id', notice.accountId)
    .eq('account_role', 'owner');

  const owners = (ownerRows ?? []) as OwnerProfile[];
  if (owners.length === 0) {
    console.warn(
      `[extension-notifier] account ${notice.accountId} has no owner profile — nobody to notify`
    );
    return [];
  }

  const tone = toneForReason(notice.reason);
  const whatHappened = sentenceForReason(notice.reason, notice.customerMessage);
  const accessDate = formatAccessDate(notice.newPeriodEnd);

  return Promise.all(
    owners.map(async (owner): Promise<RecipientOutcome> => {
      const messageInput = {
        contactName: owner.full_name,
        reason: notice.reason,
        customerMessage: notice.customerMessage,
        days: notice.days,
        newPeriodEnd: notice.newPeriodEnd,
      };

      const [whatsapp, email, inApp] = await Promise.all([
        sendWhatsApp(admin, owner, messageInput, tone),
        sendEmail(owner, whatHappened, tone, notice.days, accessDate),
        sendInApp(notice, owner, messageInput),
      ]);

      return { userId: owner.user_id, whatsapp, email, inApp };
    })
  );
}

async function sendWhatsApp(
  admin: SupabaseClient,
  owner: OwnerProfile,
  messageInput: Parameters<typeof buildExtensionTemplateParams>[0],
  tone: 'apology' | 'goodwill'
): Promise<ChannelOutcome['whatsapp']> {
  if (!owner.phone) return null;
  const phone = sanitizePhoneForMeta(owner.phone);
  if (!isValidE164(phone)) return null;

  try {
    const result = await sendPlatformTemplate(admin, {
      toPhone: phone,
      templateName: templateNameForTone(tone),
      params: buildExtensionTemplateParams(messageInput),
      fallbackText: buildExtensionFallbackText(messageInput),
    });
    return { sent: result.sent, via: result.via, error: result.error };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[extension-notifier] whatsapp failed:', error);
    return { sent: false, via: null, error };
  }
}

async function sendEmail(
  owner: OwnerProfile,
  whatHappened: string,
  tone: 'apology' | 'goodwill',
  days: number,
  accessDate: string
): Promise<ChannelOutcome['email']> {
  if (!owner.email) return null;

  try {
    const { subject, html, text } = buildSubscriptionExtensionEmail({
      recipientName: owner.full_name?.trim().split(/\s+/)[0] || 'there',
      tone,
      whatHappened,
      days,
      newPeriodEnd: accessDate,
      billingUrl: `${siteUrl()}/settings?tab=billing`,
    });
    const result = await sendTransactionalEmail({
      to: owner.email,
      subject,
      html,
      text,
    });
    return { sent: result.success, error: result.error };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[extension-notifier] email failed:', error);
    return { sent: false, error };
  }
}

async function sendInApp(
  notice: ExtensionNotice,
  owner: OwnerProfile,
  messageInput: Parameters<typeof buildExtensionNotificationCopy>[0]
): Promise<ChannelOutcome['inApp']> {
  try {
    const copy = buildExtensionNotificationCopy(messageInput);
    const result = await createNotification({
      accountId: notice.accountId,
      userId: owner.user_id,
      type: 'subscription_extended',
      title: copy.title,
      body: copy.body,
      entityType: 'subscription_extension',
      entityId: notice.extensionId,
      link: '/settings?tab=billing',
      // WhatsApp is handled above through the platform sender; letting
      // createNotification also send would ping them from their OWN
      // WABA, duplicating the message and billing the tenant for it.
      channels: { inApp: true, whatsapp: false, push: true },
    });
    return { sent: Boolean(result.inAppId) };
  } catch (err) {
    console.error('[extension-notifier] in-app failed:', err);
    return { sent: false };
  }
}
